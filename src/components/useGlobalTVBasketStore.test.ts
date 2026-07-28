import { beforeEach, describe, expect, it } from "vitest";
import { useGlobalTVBasketStore } from "@/components/useGlobalTVBasketStore";

describe("useGlobalTVBasketStore", () => {
  beforeEach(() => {
    useGlobalTVBasketStore.setState({ pinnedTvIds: [], searchQuery: "" });
  });

  it("keeps search and pinning as independent global state", () => {
    const store = useGlobalTVBasketStore.getState();
    store.setSearchQuery("EBB*");
    store.pinTv("EBBUEC1");

    expect(useGlobalTVBasketStore.getState().searchQuery).toBe("EBB*");
    expect(useGlobalTVBasketStore.getState().pinnedTvIds).toEqual(["EBBUEC1"]);

    useGlobalTVBasketStore.getState().setSearchQuery("");
    expect(useGlobalTVBasketStore.getState().pinnedTvIds).toEqual(["EBBUEC1"]);
  });

  it("pins all matches without duplicates and preserves insertion order", () => {
    const store = useGlobalTVBasketStore.getState();
    store.pinTv("TV2");
    store.pinAll(["TV1", "tv2", "TV3"]);
    expect(useGlobalTVBasketStore.getState().pinnedTvIds).toEqual(["TV2", "TV1", "TV3"]);

    useGlobalTVBasketStore.getState().togglePin("tv2");
    expect(useGlobalTVBasketStore.getState().pinnedTvIds).toEqual(["TV1", "TV3"]);
  });
});
