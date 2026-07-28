fn main() {
    // Proto lives at apps/backend-rs/proto; this build.rs runs from the transport crate dir.
    connectrpc_axum_build::compile_protos(&["../../proto/health.proto"], &["../../proto"])
        .include_file("generated.rs")
        .compile()
        .expect("compile health.proto");
    println!("cargo:rerun-if-changed=../../proto/health.proto");
}
