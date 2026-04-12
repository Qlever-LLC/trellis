#[tokio::main]
async fn main() -> miette::Result<()> {
    trellis_cli::app::run().await
}
