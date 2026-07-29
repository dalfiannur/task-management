fn main() {
    // Proto lives at apps/backend-rs/proto; this build.rs runs from the transport crate dir.
    connectrpc_axum_build::compile_protos(
        &[
            "../../proto/health.proto",
            "../../proto/users.proto",
            "../../proto/projects.proto",
            "../../proto/work.proto",
            "../../proto/pages.proto",
            "../../proto/media.proto",
            "../../proto/labels.proto",
            "../../proto/comments.proto",
            "../../proto/notifications.proto",
            "../../proto/activity.proto",
            "../../proto/dashboard.proto",
        ],
        &["../../proto"],
    )
    .include_file("generated.rs")
    .compile()
    .expect("compile protos");
    println!("cargo:rerun-if-changed=../../proto/health.proto");
    println!("cargo:rerun-if-changed=../../proto/users.proto");
    println!("cargo:rerun-if-changed=../../proto/projects.proto");
    println!("cargo:rerun-if-changed=../../proto/work.proto");
    println!("cargo:rerun-if-changed=../../proto/pages.proto");
    println!("cargo:rerun-if-changed=../../proto/media.proto");
    println!("cargo:rerun-if-changed=../../proto/labels.proto");
    println!("cargo:rerun-if-changed=../../proto/comments.proto");
    println!("cargo:rerun-if-changed=../../proto/notifications.proto");
    println!("cargo:rerun-if-changed=../../proto/activity.proto");
    println!("cargo:rerun-if-changed=../../proto/dashboard.proto");
}
