//! The portal's phone rule (sedjiwa-portal `normalizePhone`): one canonical
//! local form, `08123456789`. Accounts here keep the phone as typed, so a
//! match compares both sides in this form.

/// `+62 812-3456-789`, `628123456789`, `08123456789` and `8123456789` all
/// become `08123456789`. Empty when there are no digits.
pub fn normalize(phone: &str) -> String {
    let mut digits: String = phone.chars().filter(char::is_ascii_digit).collect();
    if digits.is_empty() {
        return String::new();
    }
    if digits.starts_with("0062") && digits.len() > 12 {
        digits = digits[4..].to_string();
    } else if digits.starts_with("62") && digits.len() > 10 {
        digits = digits[2..].to_string();
    }
    let local = digits.trim_start_matches('0');
    if local.is_empty() {
        String::new()
    } else {
        format!("0{local}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_spelling_maps_to_one_form() {
        for p in ["08123456789", "8123456789", "628123456789", "+62 812-3456-789", "00628123456789"] {
            assert_eq!(normalize(p), "08123456789", "{p}");
        }
        assert_eq!(normalize("0622123456"), "0622123456"); // an area code starting with 62 stays
        assert_eq!(normalize(""), "");
        assert_eq!(normalize("000"), "");
        assert_eq!(normalize("0812 3456 789"), "08123456789");
        assert_eq!(normalize("+62 (812) 3456-789"), "08123456789");
    }
}
