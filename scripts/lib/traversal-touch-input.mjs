export const TRAVERSAL_TOUCH_LABELS = Object.freeze({
  w: "Forward",
  a: "Left",
  s: "Back",
  d: "Right",
  " ": "Jump",
});

export function createTraversalTouchInput({
  cdp,
  touchPoint,
  firstTouchId = 101,
}) {
  const touchHeld = new Map();
  let nextTouchId = firstTouchId;

  const dispatchTouch = (type, touchPoints) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints });

  const setKeys = async (keys) => {
    const next = new Set(keys);
    for (const [key, point] of touchHeld) {
      if (!next.has(key)) {
        // CDP uses the changed point to end one finger. An empty point list
        // ends the whole sequence, which would release unrelated actions.
        await dispatchTouch("touchEnd", [point]);
        touchHeld.delete(key);
      }
    }
    for (const key of next) {
      if (touchHeld.has(key)) continue;
      const point = await touchPoint(key, nextTouchId++);
      touchHeld.set(key, point);
      await dispatchTouch("touchStart", [...touchHeld.values()]);
    }
    return [...touchHeld.keys()];
  };

  const releaseAll = async () => {
    await setKeys([]);
    return [...touchHeld.keys()];
  };

  return {
    setKeys,
    releaseAll,
    heldKeys: () => [...touchHeld.keys()],
  };
}
