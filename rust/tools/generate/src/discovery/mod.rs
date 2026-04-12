mod metadata;
mod scan;

pub use metadata::{discover_contract_metadata, parse_contract_kind};
pub use scan::{
    discover_contracts, discover_local_contracts, DiscoveredContractSource, SourceLanguage,
};
