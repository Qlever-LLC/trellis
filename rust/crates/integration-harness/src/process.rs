use std::ffi::OsString;
use std::path::PathBuf;
use std::process::{Command, ExitStatus, Output};

use miette::{IntoDiagnostic, Result, WrapErr};

#[derive(Debug, Default)]
pub(crate) struct ProcessRunner;

impl ProcessRunner {
    pub(crate) fn status(&self, spec: &CommandSpec) -> Result<ExitStatus> {
        let mut command = spec.command();
        command
            .status()
            .into_diagnostic()
            .wrap_err_with(|| format!("failed to run command `{}`", spec.display_command()))
    }

    pub(crate) fn output(&self, spec: &CommandSpec) -> Result<Output> {
        let mut command = spec.command();
        command
            .output()
            .into_diagnostic()
            .wrap_err_with(|| format!("failed to run command `{}`", spec.display_command()))
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct CommandSpec {
    program: OsString,
    args: Vec<OsString>,
    current_dir: Option<PathBuf>,
    envs: Vec<(OsString, OsString)>,
}

impl CommandSpec {
    pub(crate) fn new(program: impl Into<OsString>) -> Self {
        Self {
            program: program.into(),
            args: Vec::new(),
            current_dir: None,
            envs: Vec::new(),
        }
    }

    pub(crate) fn arg(mut self, arg: impl Into<OsString>) -> Self {
        self.args.push(arg.into());
        self
    }

    pub(crate) fn current_dir(mut self, current_dir: impl Into<PathBuf>) -> Self {
        self.current_dir = Some(current_dir.into());
        self
    }

    pub(crate) fn env(mut self, key: impl Into<OsString>, value: impl Into<OsString>) -> Self {
        self.envs.push((key.into(), value.into()));
        self
    }

    pub(crate) fn command(&self) -> Command {
        let mut command = Command::new(&self.program);
        command.args(&self.args);
        if let Some(current_dir) = &self.current_dir {
            command.current_dir(current_dir);
        }
        for (key, value) in &self.envs {
            command.env(key, value);
        }
        command
    }

    #[cfg(test)]
    pub(crate) fn envs(&self) -> &[(OsString, OsString)] {
        &self.envs
    }

    pub(crate) fn display_command(&self) -> String {
        let mut parts = Vec::with_capacity(self.args.len() + 1);
        parts.push(self.program.to_string_lossy().into_owned());
        parts.extend(
            self.args
                .iter()
                .map(|arg| arg.to_string_lossy().into_owned()),
        );
        parts.join(" ")
    }
}

#[cfg(test)]
mod tests {
    use crate::container::IntegrationWorkdir;

    use super::{CommandSpec, ProcessRunner};

    #[test]
    fn process_runner_runs_command_specs_with_current_dir() {
        let workdir = IntegrationWorkdir::create(false).expect("create workdir");
        let spec = CommandSpec::new("pwd").current_dir(workdir.path());
        let status = ProcessRunner.status(&spec).expect("run pwd");

        assert!(status.success());
    }

    #[test]
    fn command_spec_formats_command_for_errors() {
        let spec = CommandSpec::new("container-runtime").arg("--version");

        assert_eq!(spec.display_command(), "container-runtime --version");
    }

    #[test]
    fn command_spec_records_environment() {
        let spec = CommandSpec::new("deno").env("TRELLIS_CONFIG", "/tmp/config.jsonc");

        assert_eq!(spec.envs().len(), 1);
        assert_eq!(spec.envs()[0].0, "TRELLIS_CONFIG");
        assert_eq!(spec.envs()[0].1, "/tmp/config.jsonc");
    }
}
