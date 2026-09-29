//! Module: lightweight task grouping within a project (Project → Modules → Tasks).
//! "Is a module" = has [`ModuleName`].

/// Module name (required — also the "is a module" signal).
#[derive(Debug, Clone)]
pub struct ModuleName {
    pub value: String,
}

/// Optional description (component absent when empty).
#[derive(Debug, Clone)]
pub struct ModuleDescription {
    pub value: String,
}

/// Owning project (`pid` string).
#[derive(Debug, Clone)]
pub struct ModuleProjectRef {
    pub project_id: String,
}

/// Sort order within the project.
#[derive(Debug, Clone)]
pub struct ModuleOrder {
    pub value: i32,
}

/// A module name is valid iff it has non-whitespace content.
pub fn module_name_ok(name: &str) -> bool {
    !name.trim().is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_validation() {
        assert!(module_name_ok("Backlog"));
        assert!(!module_name_ok("  "));
    }
}
