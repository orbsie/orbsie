import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const query = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/server/auth", () => ({ database: () => ({ query }) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw Error("not found");
  },
}));
import PublishedOrb from "../src/app/o/[id]/page";
beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "test");
  query.mockReset();
});
it("renders only metadata of the promoted revision", async () => {
  query.mockResolvedValue({
    rows: [
      {
        title: "Private draft",
        published_revision: 3,
        public_url: "https://example.com",
        published_metadata: {
          title: "Released world",
          creator: "Artist",
          revision: 3,
        },
      },
    ],
  });
  const html = renderToStaticMarkup(
    await PublishedOrb({ params: Promise.resolve({ id: "orb" }) }),
  );
  expect(html).toContain("Released world");
  expect(html).toContain("By Artist");
  expect(html).not.toContain("Private draft");
  expect(query.mock.calls[0][0]).not.toContain("SELECT title");
});
it("does not expose draft or mismatched metadata on legacy releases", async () => {
  query.mockResolvedValue({
    rows: [
      {
        title: "Secret draft",
        published_revision: 3,
        public_url: "https://example.com",
        published_metadata: {
          title: "Pending title",
          creator: "Pending creator",
          revision: 4,
        },
      },
    ],
  });
  const html = renderToStaticMarkup(
    await PublishedOrb({ params: Promise.resolve({ id: "orb" }) }),
  );
  expect(html).toContain("Published world");
  expect(html).not.toContain("Secret draft");
  expect(html).not.toContain("Pending title");
});
