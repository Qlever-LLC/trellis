use miette::IntoDiagnostic;

use crate::artifacts::detect_output_root;
use crate::cli::DiscoverArgs;
use crate::discovery::{discover_contracts, discover_local_contracts};
use crate::output;
use crate::planning::{build_auto_plan, discover_summary_lines, execute_auto_plan};

pub fn local_generate(force: bool) -> miette::Result<()> {
    let cwd = std::env::current_dir().into_diagnostic()?;
    let discovered = discover_local_contracts(&cwd)?;
    let plan = build_auto_plan(discovered, None)?;
    execute_auto_plan(&plan, Some("Trellis Generate"), false, force).map(|_| ())
}

pub fn discover(args: &DiscoverArgs, force: bool) -> miette::Result<()> {
    let canonical_root = args.root.canonicalize().into_diagnostic()?;
    let shared_output_root = detect_output_root(&canonical_root);
    let plan = build_auto_plan(discover_contracts(&args.root)?, Some(&shared_output_root))?;
    output::print_title("Trellis Generate Discover");
    output::print_detail("root", args.root.display().to_string());
    if plan.is_empty() {
        output::print_info("No contracts found.");
        return Ok(());
    }
    output::print_section("Plan");
    output::print_discover_summary(&discover_summary_lines(&plan));
    let summary = execute_auto_plan(&plan, None, true, force)?;
    output::print_section("Result");
    output::print_info(&output::summary_line("generated", summary.generated));
    output::print_info(&output::summary_line("verified", summary.verified));
    output::print_info(&output::summary_line("skipped", summary.skipped));
    Ok(())
}
