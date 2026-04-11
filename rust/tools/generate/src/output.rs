use owo_colors::OwoColorize;

pub fn print_title(title: &str) {
    println!("{}", title.bold().cyan());
}

pub fn print_section(title: &str) {
    println!("\n{}", title.bold().blue());
}

pub fn print_success(message: &str) {
    println!("{} {}", "OK".green().bold(), message);
}

pub fn print_info(message: &str) {
    println!("{}", message);
}

pub fn print_detail(label: &str, value: impl AsRef<str>) {
    println!("  {} {}", format!("{label}:").bold(), value.as_ref());
}

pub fn print_discover_summary(lines: &[String]) {
    for line in lines {
        println!("{}", line);
    }
}

pub fn summary_line(label: &str, value: usize) -> String {
    format!("  {} {}", format!("{label}:").bold(), value)
}
