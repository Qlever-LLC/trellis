use miette::IntoDiagnostic;

use crate::artifacts::detect_output_root;
use crate::cli::PrepareArgs;
use crate::discovery::discover_contracts;
use crate::output;
use crate::planning::{build_auto_plan, execute_auto_plan};

pub fn run(args: &PrepareArgs, force: bool) -> miette::Result<()> {
    let canonical_root = args.root.canonicalize().into_diagnostic()?;
    let shared_output_root = detect_output_root(&canonical_root);
    let plan = build_auto_plan(discover_contracts(&args.root)?, Some(&shared_output_root))?;
    if plan.is_empty() {
        output::print_title("Trellis Prepare");
        output::print_detail("root", args.root.display().to_string());
        output::print_info("No contracts found.");
        return Ok(());
    }
    execute_auto_plan(&plan, Some("Trellis Prepare"), false, force).map(|_| ())
}
