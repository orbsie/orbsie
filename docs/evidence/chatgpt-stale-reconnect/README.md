# Hosted ChatGPT stale reconnect fixture

Source: `fd1caea`. Local production build; all API/account responses intercepted.
Twelve scenarios passed with zero external requests and zero live model calls.
Actual buttons verified stale status and model-list responses show Reconnect
ChatGPT, no logout/start before click, logout before start after click, and no
start after failed logout. Root reviewed harness assertions and report.
This is UI integration evidence, not real ChatGPT consent or inference.
