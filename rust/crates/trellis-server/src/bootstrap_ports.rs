use futures_util::future::BoxFuture;

use crate::{
    validate_bootstrap_contract_state, BootstrapBinding, BootstrapContractRef, ServerError,
};

/// A resolved service binding that can expose the validated contract id/digest pair.
pub trait BootstrapBindingInfo: Clone + Send + Sync {
    fn bootstrap_binding(&self) -> BootstrapBinding;
}

impl BootstrapBindingInfo for BootstrapBinding {
    fn bootstrap_binding(&self) -> BootstrapBinding {
        self.clone()
    }
}

/// Port for querying Trellis core bootstrap data.
pub trait CoreBootstrapPort: Send + Sync {
    type Binding: BootstrapBindingInfo;

    fn fetch_catalog_contracts<'a>(
        &'a self,
    ) -> BoxFuture<'a, Result<Vec<BootstrapContractRef>, ServerError>>;

    fn fetch_binding<'a>(
        &'a self,
        expected: &'a BootstrapContractRef,
    ) -> BoxFuture<'a, Result<Option<Self::Binding>, ServerError>>;
}

/// Resolve and validate bootstrap state using the core bootstrap port.
pub async fn resolve_bootstrap_binding<C>(
    service_name: &str,
    expected: &BootstrapContractRef,
    core: &C,
) -> Result<C::Binding, ServerError>
where
    C: CoreBootstrapPort,
{
    let catalog = core.fetch_catalog_contracts().await?;
    let binding = core.fetch_binding(expected).await?;

    let validated_binding = binding
        .as_ref()
        .map(BootstrapBindingInfo::bootstrap_binding);
    validate_bootstrap_contract_state(
        service_name,
        expected,
        &catalog,
        validated_binding.as_ref(),
    )?;

    binding.ok_or_else(|| ServerError::BootstrapMissingBinding {
        service_name: service_name.to_string(),
        contract_id: expected.id.clone(),
        contract_digest: expected.digest.clone(),
    })
}
