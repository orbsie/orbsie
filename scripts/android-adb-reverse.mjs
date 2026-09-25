const REVERSE_BIND_COLLISION = "cannot bind listener: Address already in use";

function outputLines(value) {
  if (value === undefined || value === null) return [];
  const output = Buffer.isBuffer(value)
    ? value.toString("utf8")
    : String(value);
  return output
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^(?:adb:\s*)?error:\s*/, ""));
}

export function isAdbReverseBindCollision(error) {
  return [error?.stderr, error?.stdout, error?.message]
    .flatMap(outputLines)
    .some((line) => line === REVERSE_BIND_COLLISION);
}

export function installAdbReverseWithRetry({
  choosePort,
  installReverse,
  maxAttempts = 5,
  onCollision,
}) {
  if (typeof choosePort !== "function" || typeof installReverse !== "function")
    throw new TypeError(
      "ADB reverse retry requires port and install functions.",
    );
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1)
    throw new RangeError(
      "ADB reverse retry attempts must be a positive integer.",
    );

  const attemptedPorts = new Set();
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const port = choosePort(attemptedPorts);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new RangeError(
        "ADB reverse port chooser returned an invalid port.",
      );
    if (attemptedPorts.has(port))
      throw new Error("ADB reverse port chooser repeated an attempted port.");
    attemptedPorts.add(port);

    try {
      installReverse(port);
      return port;
    } catch (error) {
      if (!isAdbReverseBindCollision(error) || attempt === maxAttempts)
        throw error;
      onCollision?.({ port, attempt, maxAttempts });
    }
  }

  throw new Error("ADB reverse installation exhausted its retry limit.");
}
