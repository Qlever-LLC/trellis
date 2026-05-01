pub mod app;
pub mod artifacts;
pub mod cli;
pub mod commands;
mod contract_input;
pub mod discovery;
pub mod output;
pub mod planning;
pub mod self_update;

pub fn run() -> miette::Result<()> {
    app::run()
}
