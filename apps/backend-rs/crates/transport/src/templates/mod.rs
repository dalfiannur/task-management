//! Templates: projects copied from another (`ProjectService.CreateProject`
//! with `from_project_id`) and per-project task templates (`TemplateService`).

pub(crate) mod record;
pub(crate) mod template_service;

pub use template_service::template_router;
