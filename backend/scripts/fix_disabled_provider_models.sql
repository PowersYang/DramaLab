update duanju_dev.model_catalog_entries as entry
set enabled = false,
    updated_at = now()
from duanju_dev.model_provider_configs as provider
where provider.provider_key = entry.provider_key
  and provider.enabled = false
  and entry.enabled = true;

select
    provider.provider_key,
    provider.enabled as provider_enabled,
    count(*) filter (where entry.enabled = true) as enabled_model_count
from duanju_dev.model_provider_configs as provider
left join duanju_dev.model_catalog_entries as entry
    on entry.provider_key = provider.provider_key
group by provider.provider_key, provider.enabled
order by provider.provider_key;
