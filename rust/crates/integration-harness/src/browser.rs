use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use miette::{miette, IntoDiagnostic, Result, WrapErr};
use thirtyfour::prelude::*;

use crate::container::{unique_container_name, ContainerBackend};
use crate::nats::{inspect_container_port, remove_container, wait_for_tcp_ready};
use crate::process::{command_output_failure_message, CommandSpec, ProcessRunner};

const CHROMIUM_IMAGE: &str = "docker.io/selenium/standalone-chromium";

#[derive(Debug)]
pub(crate) struct BrowserContainer {
    runtime: &'static str,
    name: String,
    webdriver_url: String,
    host_origin: String,
}

impl BrowserContainer {
    pub(crate) async fn start(
        process_runner: &ProcessRunner,
        backend: ContainerBackend,
    ) -> Result<Self> {
        let name = unique_container_name("browser")?;
        let mut spec = CommandSpec::new(backend.program())
            .arg("run")
            .arg("--detach")
            .arg("--name")
            .arg(&name)
            .arg("--publish")
            .arg("127.0.0.1::4444")
            .arg("--shm-size")
            .arg("2g");
        if backend.is_docker() {
            spec = spec
                .arg("--add-host")
                .arg("host.docker.internal:host-gateway");
        }
        spec = spec.arg(CHROMIUM_IMAGE);

        let output = process_runner.output(&spec)?;
        if !output.status.success() {
            return Err(miette!(
                "{}",
                command_output_failure_message("failed to start browser container", &spec, &output)
            ));
        }

        let webdriver_port = match inspect_container_port(process_runner, backend, &name, 4444) {
            Ok(port) => port,
            Err(error) => {
                remove_container(backend, &name);
                return Err(error);
            }
        };
        if let Err(error) = wait_for_tcp_ready(webdriver_port, Duration::from_secs(45)) {
            remove_container(backend, &name);
            return Err(error);
        }

        let container = Self {
            runtime: backend.program(),
            name,
            webdriver_url: format!("http://127.0.0.1:{webdriver_port}"),
            host_origin: browser_host_origin(backend),
        };
        if let Err(error) = container.wait_for_webdriver().await {
            remove_container(backend, &container.name);
            return Err(error);
        }
        Ok(container)
    }

    pub(crate) fn webdriver_url(&self) -> &str {
        &self.webdriver_url
    }

    pub(crate) fn trellis_origin(&self, trellis_port: u16) -> String {
        format!("http://{}:{trellis_port}", self.host_origin)
    }

    pub(crate) async fn driver(&self) -> Result<WebDriver> {
        let mut caps = DesiredCapabilities::chrome();
        caps.add_arg("--headless=new").into_diagnostic()?;
        caps.add_arg("--no-sandbox").into_diagnostic()?;
        WebDriver::new(self.webdriver_url(), caps)
            .await
            .into_diagnostic()
            .map_err(Into::into)
    }

    async fn wait_for_webdriver(&self) -> Result<()> {
        let deadline = std::time::Instant::now() + Duration::from_secs(60);
        loop {
            match self.driver().await {
                Ok(driver) => {
                    driver.quit().await.into_diagnostic()?;
                    return Ok(());
                }
                Err(error) if std::time::Instant::now() >= deadline => {
                    return Err(miette!(
                        "timed out waiting for WebDriver readiness: {error}"
                    ));
                }
                Err(_) => tokio::time::sleep(Duration::from_millis(500)).await,
            }
        }
    }
}

impl Drop for BrowserContainer {
    fn drop(&mut self) {
        remove_container(ContainerBackend::new(self.runtime), &self.name);
    }
}

pub(crate) async fn complete_admin_bootstrap(
    driver: &WebDriver,
    bootstrap_url: &str,
    username: &str,
    password: &str,
    name: &str,
    email: &str,
) -> Result<()> {
    driver.goto(bootstrap_url).await.into_diagnostic()?;
    let _ = username;
    wait_for_page_text(driver, &["Reset your password"], Duration::from_secs(30)).await?;
    fill_input(driver, "input[autocomplete='new-password']", password).await?;
    fill_input(driver, "input[autocomplete='name']", name).await?;
    fill_input(driver, "input[autocomplete='email']", email).await?;
    find_css(driver, "button[type='submit']", Duration::from_secs(30))
        .await?
        .click()
        .await
        .into_diagnostic()?;
    wait_for_page_text(driver, &["Password saved"], Duration::from_secs(30)).await
}

pub(crate) async fn complete_local_login(
    driver: &WebDriver,
    login_url: &str,
    username: &str,
    password: &str,
) -> Result<()> {
    submit_local_login(driver, login_url, username, password).await?;
    let source = driver.source().await.into_diagnostic()?;
    if source.contains("Approve access") {
        approve_current_flow(driver).await?;
    }
    wait_for_page_text(
        driver,
        &["Connected", "Return to the CLI"],
        Duration::from_secs(30),
    )
    .await
}

pub(crate) async fn complete_local_login_until_approval(
    driver: &WebDriver,
    login_url: &str,
    username: &str,
    password: &str,
) -> Result<()> {
    submit_local_login(driver, login_url, username, password).await?;
    let source = driver.source().await.into_diagnostic()?;
    if source.contains("Approve access") {
        Ok(())
    } else {
        Err(miette!(
            "local login reached connected state without approval screen"
        ))
    }
}

async fn submit_local_login(
    driver: &WebDriver,
    login_url: &str,
    username: &str,
    password: &str,
) -> Result<()> {
    driver.goto(login_url).await.into_diagnostic()?;
    wait_for_page_text(
        driver,
        &["Choose a sign-in method"],
        Duration::from_secs(30),
    )
    .await?;
    fill_input(driver, "input[autocomplete='username']", username).await?;
    fill_input(driver, "input[autocomplete='current-password']", password).await?;
    find_css(driver, "button[type='submit']", Duration::from_secs(30))
        .await?
        .click()
        .await
        .into_diagnostic()?;
    wait_for_page_text(
        driver,
        &["Connected", "Approve access"],
        Duration::from_secs(30),
    )
    .await?;
    Ok(())
}

pub(crate) async fn approve_current_flow(driver: &WebDriver) -> Result<()> {
    find_xpath(
        driver,
        "//button[normalize-space()='Approve']",
        Duration::from_secs(30),
    )
    .await?
    .click()
    .await
    .into_diagnostic()?;
    Ok(())
}

async fn fill_input(driver: &WebDriver, selector: &str, value: &str) -> Result<()> {
    let input = find_css(driver, selector, Duration::from_secs(30)).await?;
    input.clear().await.into_diagnostic()?;
    input.send_keys(value).await.into_diagnostic()?;
    Ok(())
}

async fn find_css(driver: &WebDriver, selector: &str, timeout: Duration) -> Result<WebElement> {
    find_element(driver, || By::Css(selector), selector, timeout).await
}

async fn find_xpath(driver: &WebDriver, selector: &str, timeout: Duration) -> Result<WebElement> {
    find_element(driver, || By::XPath(selector), selector, timeout).await
}

async fn find_element(
    driver: &WebDriver,
    by: impl Fn() -> By,
    selector: &str,
    timeout: Duration,
) -> Result<WebElement> {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        match driver.find(by()).await {
            Ok(element) => return Ok(element),
            Err(error) if std::time::Instant::now() >= deadline => {
                let source = driver
                    .source()
                    .await
                    .unwrap_or_else(|_| "<unavailable>".to_string());
                let artifact_note = write_browser_artifacts(driver, selector).await;
                return Err(miette!(
                    "timed out waiting for browser element `{selector}`: {error}; page source: {}; {}",
                    source.chars().take(2000).collect::<String>(),
                    artifact_note
                ));
            }
            Err(_) => tokio::time::sleep(Duration::from_millis(250)).await,
        }
    }
}

async fn wait_for_page_text(driver: &WebDriver, needles: &[&str], timeout: Duration) -> Result<()> {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        let source = driver.source().await.into_diagnostic()?;
        if needles.iter().any(|needle| source.contains(needle)) {
            return Ok(());
        }
        if std::time::Instant::now() >= deadline {
            let source = driver
                .source()
                .await
                .unwrap_or_else(|_| "<unavailable>".to_string());
            let artifact_note = write_browser_artifacts(driver, &needles.join("-or-")).await;
            return Err(miette!(
                "timed out waiting for browser page text: {}; page source: {}; {}",
                needles.join(" or "),
                source.chars().take(2000).collect::<String>(),
                artifact_note
            ));
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

async fn write_browser_artifacts(driver: &WebDriver, label: &str) -> String {
    match try_write_browser_artifacts(driver, label).await {
        Ok(path) => format!("browser artifacts: {}", path.display()),
        Err(error) => format!("browser artifact capture failed: {error}"),
    }
}

async fn try_write_browser_artifacts(driver: &WebDriver, label: &str) -> Result<PathBuf> {
    let root = std::env::var_os("TRELLIS_INTEGRATION_BROWSER_ARTIFACT_DIR")
        .map(PathBuf::from)
        .ok_or_else(|| miette!("TRELLIS_INTEGRATION_BROWSER_ARTIFACT_DIR is not set"))?;
    std::fs::create_dir_all(&root)
        .into_diagnostic()
        .wrap_err_with(|| {
            format!(
                "failed to create browser artifact directory {}",
                root.display()
            )
        })?;
    let dir = root.join(format!(
        "{}-{}",
        unique_artifact_suffix()?,
        sanitize_artifact_label(label)
    ));
    std::fs::create_dir_all(&dir)
        .into_diagnostic()
        .wrap_err_with(|| {
            format!(
                "failed to create browser artifact directory {}",
                dir.display()
            )
        })?;

    let url = driver
        .current_url()
        .await
        .map(|url| url.to_string())
        .unwrap_or_else(|error| format!("<unavailable: {error}>"));
    std::fs::write(dir.join("url.txt"), url)
        .into_diagnostic()
        .wrap_err("failed to write browser URL artifact")?;

    let source = driver
        .source()
        .await
        .unwrap_or_else(|error| format!("<unavailable: {error}>"));
    std::fs::write(dir.join("page.html"), source)
        .into_diagnostic()
        .wrap_err("failed to write browser page source artifact")?;

    if let Ok(screenshot) = driver.screenshot_as_png().await {
        std::fs::write(dir.join("screenshot.png"), screenshot)
            .into_diagnostic()
            .wrap_err("failed to write browser screenshot artifact")?;
    }

    Ok(dir)
}

fn sanitize_artifact_label(label: &str) -> String {
    let mut sanitized = String::new();
    let mut previous_was_dash = false;
    for character in label.chars() {
        let safe = matches!(character, 'a'..='z' | 'A'..='Z' | '0'..='9' | '_' | '-');
        if safe {
            sanitized.push(character);
            previous_was_dash = false;
        } else if !previous_was_dash {
            sanitized.push('-');
            previous_was_dash = true;
        }
    }
    let sanitized = sanitized.trim_matches('-');
    if sanitized.is_empty() {
        "browser".to_string()
    } else {
        sanitized.to_string()
    }
}

fn unique_artifact_suffix() -> Result<u128> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .into_diagnostic()
        .wrap_err("system clock is before UNIX epoch")?
        .as_nanos())
}

fn browser_host_origin(backend: ContainerBackend) -> String {
    if backend.is_docker() {
        "host.docker.internal".to_string()
    } else {
        "host.containers.internal".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::{browser_host_origin, sanitize_artifact_label};
    use crate::container::ContainerBackend;

    #[test]
    fn browser_host_origin_uses_runtime_specific_host_gateway() {
        assert_eq!(
            browser_host_origin(ContainerBackend::new("docker")),
            "host.docker.internal"
        );
        assert_eq!(
            browser_host_origin(ContainerBackend::new("podman")),
            "host.containers.internal"
        );
    }

    #[test]
    fn artifact_labels_are_filesystem_safe() {
        assert_eq!(
            sanitize_artifact_label("input[autocomplete='name']"),
            "input-autocomplete-name"
        );
        assert_eq!(sanitize_artifact_label("///"), "browser");
    }
}
