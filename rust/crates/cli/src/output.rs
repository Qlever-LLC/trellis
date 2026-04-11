use comfy_table::{presets::UTF8_FULL, Cell, Table};
use owo_colors::OwoColorize;
use serde::Serialize;

use crate::cli::OutputFormat;

pub fn print_json<T: Serialize>(value: &T) -> miette::Result<()> {
    println!("{}", serde_json::to_string_pretty(value).into_diagnostic()?);
    Ok(())
}

pub fn print_success(message: &str) {
    println!("{} {}", "ok".green().bold(), message);
}

pub fn print_info(message: &str) {
    println!("{}", message);
}

pub fn table(headers: &[&str], rows: Vec<Vec<String>>) -> String {
    let mut table = Table::new();
    table.load_preset(UTF8_FULL);
    table.set_header(headers.iter().map(|header| Cell::new(*header)));
    for row in rows {
        table.add_row(row);
    }
    table.to_string()
}

pub fn is_json(format: OutputFormat) -> bool {
    matches!(format, OutputFormat::Json)
}

use miette::IntoDiagnostic;
