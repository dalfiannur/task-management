//! HTML sanitization for user-authored rich-text content (Tiptap output).
//! Allowlist mirrors exactly what the frontend editor can emit.

use ammonia::Builder;
use std::collections::HashSet;

/// Sanitize an HTML fragment, keeping only the tags/attributes the rich-text
/// editor produces. Everything else (scripts, event handlers, unknown tags,
/// unsafe URL schemes) is stripped.
pub fn clean_html(input: &str) -> String {
    let tags: HashSet<&str> = [
        "h1", "h2", "h3", "p", "strong", "em", "s", "code", "pre", "blockquote",
        "ul", "ol", "li", "a", "br", "span",
    ]
    .into_iter()
    .collect();

    Builder::default()
        .tags(tags)
        .add_tag_attributes("a", &["href"])
        .add_tag_attributes("span", &["data-type", "data-id"])
        .clean_content_tags(["script", "style"].into_iter().collect())
        .link_rel(Some("noopener noreferrer nofollow"))
        .clean(input)
        .to_string()
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
        let out = clean_html(
            r#"<p><span data-type="mention" data-id="u1">@Ann</span></p>"#,
        );
        assert!(out.contains(r#"data-type="mention""#));
        assert!(out.contains(r#"data-id="u1""#));
    }
}
