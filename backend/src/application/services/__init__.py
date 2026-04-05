from importlib import import_module

__all__ = [
    "CharacterService",
    "AssetService",
    "AuthRateLimitError",
    "AuthService",
    "BillingAccountUnavailableError",
    "BillingError",
    "BillingInsufficientBalanceError",
    "BillingPricingNotConfiguredError",
    "BillingReconcileService",
    "BillingService",
    "ModelProviderService",
    "ProjectService",
    "ProjectTimelineService",
    "ProjectCommandService",
    "ProjectSeriesCastingService",
    "ProjectMutationService",
    "PaymentError",
    "PaymentService",
    "PropService",
    "SceneService",
    "SeriesMutationService",
    "SeriesService",
    "SeriesCommandService",
    "SeriesCharacterMigrationService",
    "SeriesAssetExtractService",
    "SeriesAssetInboxService",
    "SeriesEntityResolutionService",
    "StoryboardFrameService",
    "SystemService",
    "TenantAdminService",
    "VideoTaskService",
]

_EXPORT_MAP = {
    "AssetService": (".asset_service", "AssetService"),
    "AuthRateLimitError": (".auth_service", "AuthRateLimitError"),
    "AuthService": (".auth_service", "AuthService"),
    "BillingAccountUnavailableError": (".billing_service", "BillingAccountUnavailableError"),
    "BillingError": (".billing_service", "BillingError"),
    "BillingInsufficientBalanceError": (".billing_service", "BillingInsufficientBalanceError"),
    "BillingPricingNotConfiguredError": (".billing_service", "BillingPricingNotConfiguredError"),
    "BillingReconcileService": (".billing_reconcile_service", "BillingReconcileService"),
    "BillingService": (".billing_service", "BillingService"),
    "CharacterService": (".character_service", "CharacterService"),
    "ModelProviderService": (".model_provider_service", "ModelProviderService"),
    "ProjectService": (".project_service", "ProjectService"),
    "ProjectTimelineService": (".project_timeline_service", "ProjectTimelineService"),
    "ProjectCommandService": (".project_command_service", "ProjectCommandService"),
    "ProjectSeriesCastingService": (".project_series_casting_service", "ProjectSeriesCastingService"),
    "ProjectMutationService": (".project_mutation_service", "ProjectMutationService"),
    "PaymentError": (".payment_service", "PaymentError"),
    "PaymentService": (".payment_service", "PaymentService"),
    "PropService": (".prop_service", "PropService"),
    "SceneService": (".scene_service", "SceneService"),
    "SeriesMutationService": (".series_mutation_service", "SeriesMutationService"),
    "SeriesService": (".series_service", "SeriesService"),
    "SeriesCommandService": (".series_command_service", "SeriesCommandService"),
    "SeriesCharacterMigrationService": (".series_character_migration_service", "SeriesCharacterMigrationService"),
    "SeriesAssetExtractService": (".series_asset_extract_service", "SeriesAssetExtractService"),
    "SeriesAssetInboxService": (".series_asset_inbox_service", "SeriesAssetInboxService"),
    "SeriesEntityResolutionService": (".series_entity_resolution_service", "SeriesEntityResolutionService"),
    "StoryboardFrameService": (".storyboard_frame_service", "StoryboardFrameService"),
    "SystemService": (".system_service", "SystemService"),
    "TenantAdminService": (".tenant_admin_service", "TenantAdminService"),
    "VideoTaskService": (".video_task_service", "VideoTaskService"),
}


def __getattr__(name):
    if name not in _EXPORT_MAP:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    module_name, attribute_name = _EXPORT_MAP[name]
    module = import_module(module_name, __name__)
    value = getattr(module, attribute_name)
    globals()[name] = value
    return value


def __dir__():
    return sorted(set(globals()) | set(__all__))

"""
应用服务层导出入口。

这里的 service 负责 CRUD 风格用例和小范围业务操作；
跨资源、长链路的流程编排则放在 ``application.workflows``。
"""
