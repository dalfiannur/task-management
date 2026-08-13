//! HTML sanitization for user-authored rich-text content (Tiptap output).
//! Allowlist tracks what the frontend editor (StarterKit + mention) can emit:
//! headings h1-h6, paragraphs, inline marks (bold/italic/strike/underline/code),
//! code blocks, blockquotes, lists, links, line breaks, horizontal rules, and
//! mention spans (with their round-trippable `data-*` attributes).

use ammonia::Builder;
use std::collections::HashSet;

/// Sanitize an HTML fragment, keeping only the tags/attributes the rich-text
/// editor produces. Everything else (scripts, event handlers, unknown tags,
/// unsafe URL schemes) is stripped.
pub fn clean_html(input: &str) -> String {
    let tags: HashSet<&str> = [
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "p",
        "strong",
        "em",
        "s",
        "u",
        "code",
        "pre",
        "blockquote",
        "ul",
        "ol",
        "li",
        "a",
        "br",
        "hr",
        "span",
    ]
    .into_iter()
    .collect();

    Builder::default()
        .tags(tags)
        .add_tag_attributes("a", &["href"])
        .add_tag_attributes("span", &["data-type", "data-id", "data-label"])
        .clean_content_tags(["script", "style"].into_iter().collect())
        .link_rel(Some("noopener noreferrer nofollow"))
        .clean(input)
        .to_string()
}

/// Project rich-text HTML down to the words inside it, for full-text indexing.
///
/// Block tags become spaces first, so `<p>a</p><p>b</p>` indexes as two tokens
/// rather than one. `ammonia` with an empty tag allowlist then removes every
/// remaining tag while keeping its text, and drops `script`/`style` content
/// entirely.
pub fn plain_text(input: &str) -> String {
    let spaced = input
        .replace("</p>", "</p> ")
        .replace("<br>", " ")
        .replace("<br/>", " ")
        .replace("<br />", " ")
        .replace("</li>", "</li> ")
        .replace("</h1>", "</h1> ")
        .replace("</h2>", "</h2> ")
        .replace("</h3>", "</h3> ")
        .replace("</h4>", "</h4> ")
        .replace("</h5>", "</h5> ")
        .replace("</h6>", "</h6> ")
        .replace("</blockquote>", "</blockquote> ")
        .replace("</pre>", "</pre> ");
    let stripped = Builder::default()
        .tags(HashSet::new())
        .clean_content_tags(["script", "style"].into_iter().collect())
        .clean(&spaced)
        .to_string();
    // Ammonia HTML-escapes the text it keeps (e.g. a literal `&` becomes
    // `&amp;`), which would otherwise hand Postgres the token `amp` instead of
    // `&`. Decode that closed, known entity set back to plain characters
    // before collapsing whitespace so the tsvector and any snippet stay clean.
    let decoded = decode_entities(&stripped);
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Undo the HTML entity-escaping `ammonia` applies to kept text. The set is
/// closed because `ammonia` is the only emitter here, so no crate dependency
/// is needed for this.
///
/// `&amp;` is decoded *last*, deliberately: every other entity starts with
/// `&`, so if `&amp;` were decoded first, a double-escaped sequence like
/// `&amp;lt;` (i.e. `&lt;` escaped again) would turn into `&lt;` and then, on
/// a second pass, wrongly collapse all the way to `<`. Decoding `&amp;` last
/// guarantees each entity is unescaped exactly once.
fn decode_entities(input: &str) -> String {
    input
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_script_tags() {
        let out = clean_html("<p>hi</p><script>alert(1)</script>");
        assert!(!out.contains("script"));
        assert!(!out.contains("alert"));
        assert!(out.contains("<p>hi</p>"));
    }

    #[test]
    fn strips_event_handlers() {
        let out = clean_html(r#"<p onclick="steal()">x</p>"#);
        assert!(!out.contains("onclick"));
    }

    #[test]
    fn strips_javascript_urls() {
        let out = clean_html(r#"<a href="javascript:alert(1)">x</a>"#);
        assert!(!out.contains("javascript:"));
    }

    #[test]
    fn keeps_allowlisted_formatting() {
        let out = clean_html("<h1>T</h1><ul><li><strong>a</strong></li></ul>");
        assert!(out.contains("<h1>T</h1>"));
        assert!(out.contains("<strong>a</strong>"));
        assert!(out.contains("<li>"));
    }

    #[test]
    fn keeps_mention_span() {
        let out = clean_html(r#"<p><span data-type="mention" data-id="u1">@Ann</span></p>"#);
        assert!(out.contains(r#"data-type="mention""#));
        assert!(out.contains(r#"data-id="u1""#));
    }

    #[test]
    fn keeps_underline() {
        let out = clean_html("<p><u>x</u></p>");
        assert!(out.contains("<u>x</u>"));
    }

    #[test]
    fn keeps_horizontal_rule() {
        let out = clean_html("<p>a</p><hr><p>b</p>");
        assert!(out.contains("<hr"));
    }

    #[test]
    fn keeps_mention_label() {
        let out =
            clean_html(r#"<span data-type="mention" data-id="u1" data-label="Ann">@Ann</span>"#);
        assert!(out.contains(r#"data-label="Ann""#));
        assert!(out.contains(r#"data-id="u1""#));
    }

    #[test]
    fn plain_text_strips_tags_and_keeps_words() {
        let out =
            plain_text("<p>Perbaiki <strong>reset</strong> password</p><ul><li>satu</li></ul>");
        assert!(!out.contains('<'), "no markup left: {out}");
        assert!(out.contains("Perbaiki"));
        assert!(out.contains("reset"));
        assert!(out.contains("satu"));
    }

    #[test]
    fn plain_text_separates_adjacent_blocks() {
        // Without separation these would index as one nonsense token.
        let out = plain_text("<p>alpha</p><p>beta</p>");
        assert!(
            out.contains("alpha beta") || out.contains("alpha\nbeta"),
            "got: {out}"
        );
    }

    #[test]
    fn plain_text_drops_script_content() {
        let out = plain_text("<p>hi</p><script>alert(1)</script>");
        assert!(!out.contains("alert"));
    }

    #[test]
    fn plain_text_decodes_amp_entity() {
        let out = plain_text("Tom &amp; Jerry");
        assert_eq!(out, "Tom & Jerry");
        assert!(!out.contains("amp"), "no junk `amp` token: {out}");
    }

    #[test]
    fn plain_text_decodes_only_one_level_of_double_escaping() {
        // `&amp;lt;` is `&lt;` escaped again. Decoding `&amp;` before `&lt;`
        // would wrongly collapse this all the way down to `<`.
        let out = plain_text("<p>a &amp;lt; b</p>");
        assert_eq!(out, "a &lt; b");
    }

    #[test]
    fn plain_text_round_trips_raw_ampersand() {
        let out = plain_text("Tom & Jerry");
        assert_eq!(out, "Tom & Jerry");
    }
}
