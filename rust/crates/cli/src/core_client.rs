use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use trellis_client::{TrellisClient, TrellisClientError};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisCatalogContract {
    pub description: String,
    pub digest: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisCatalog {
    pub contracts: Vec<TrellisCatalogContract>,
    pub format: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisCatalogResponse {
    pub catalog: TrellisCatalog,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisContractGetRequest {
    pub digest: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisContractGetResponse {
    pub contract: Value,
}

#[derive(Debug, Serialize)]
struct Empty {}

pub struct CoreClient<'a> {
    inner: &'a TrellisClient,
}

impl<'a> CoreClient<'a> {
    pub fn new(inner: &'a TrellisClient) -> Self {
        Self { inner }
    }

    async fn call<Input, Output>(
        &self,
        subject: &str,
        input: &Input,
    ) -> Result<Output, TrellisClientError>
    where
        Input: Serialize,
        Output: DeserializeOwned,
    {
        let request = serde_json::to_value(input)?;
        let response = self.inner.request_json_value(subject, &request).await?;
        Ok(serde_json::from_value(response)?)
    }

    pub async fn catalog(&self) -> Result<TrellisCatalogResponse, TrellisClientError> {
        self.call("rpc.v1.Trellis.Catalog", &Empty {}).await
    }

    pub async fn contract_get(
        &self,
        digest: &str,
    ) -> Result<TrellisContractGetResponse, TrellisClientError> {
        self.call(
            "rpc.v1.Trellis.Contract.Get",
            &TrellisContractGetRequest {
                digest: digest.to_string(),
            },
        )
        .await
    }
}
