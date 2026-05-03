mod docker;
mod dotnet;
mod java;
mod node;
mod scripting;
mod systems;

use super::RuntimeProvider;

pub(super) fn all() -> Vec<Box<dyn RuntimeProvider>> {
    vec![
        Box::new(node::NodeProvider),
        Box::new(dotnet::DotnetProvider),
        Box::new(java::JavaMavenProvider),
        Box::new(java::JavaGradleProvider),
        Box::new(systems::GoProvider),
        Box::new(systems::RustProvider),
        Box::new(scripting::PythonProvider),
        Box::new(scripting::RubyProvider),
        Box::new(scripting::PhpProvider),
        Box::new(docker::DockerProvider),
    ]
}
