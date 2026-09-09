// Test-only observer: does not replace responses, commands, or provider requests.
export async function installGenerationDiagnosticObserver(page) {
  await page.evaluate(() => {
    if (window.__orbsieDiagnosticObserver) return;
    const state = { records: [], pending: [] };
    window.__orbsieDiagnosticObserver = state;
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await original(...args);
      const url = new URL(response.url);
      if (url.origin === location.origin && url.pathname === "/api/generate") {
        const copy = response.clone();
        const read = (async () => {
          const reader = copy.body.getReader();
          const decoder = new TextDecoder();
          let bytes = 0,
            pending = "";
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              bytes += value.byteLength;
              if (bytes > 1000000) break;
              pending += decoder.decode(value, { stream: true });
              const lines = pending.split("\n");
              pending = lines.pop();
              for (const line of lines) {
                let record;
                try {
                  record = JSON.parse(line);
                } catch {
                  continue;
                }
                if (
                  !["INVALID_SCENE_UPDATE", "INVALID_SCENE_JSON"].includes(
                    record.code,
                  )
                )
                  continue;
                if (state.records.length < 8)
                  state.records.push({
                    code: record.code,
                    diagnostic: JSON.stringify(record.diagnostic ?? {}).slice(
                      0,
                      4000,
                    ),
                  });
              }
            }
          } finally {
            await reader.cancel().catch(() => {});
          }
        })().catch(() => {});
        state.pending.push(read);
      }
      return response;
    };
  });
}
export async function readGenerationDiagnostics(page) {
  return page.evaluate(async () => {
    const state = window.__orbsieDiagnosticObserver;
    if (!state) return [];
    await Promise.allSettled(state.pending);
    return state.records;
  });
}
