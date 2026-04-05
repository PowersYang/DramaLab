import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import BillingActionButton from "@/components/billing/BillingActionButton";

describe("BillingActionButton", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps tooltip below the button when there is enough space", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function mockRect() {
      if ((this as HTMLElement).dataset.testid === "billing-action-wrapper") {
        return {
          x: 120,
          y: 120,
          width: 180,
          height: 44,
          top: 120,
          right: 300,
          bottom: 164,
          left: 120,
          toJSON: () => ({}),
        };
      }
      if ((this as HTMLElement).textContent?.includes("预计消耗12算力豆")) {
        return {
          x: 0,
          y: 0,
          width: 180,
          height: 42,
          top: 0,
          right: 180,
          bottom: 42,
          left: 0,
          toJSON: () => ({}),
        };
      }
      return {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        toJSON: () => ({}),
      };
    });

    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 900,
    });

    render(
      <BillingActionButton priceCredits={12} balanceCredits={50}>
        开始识别
      </BillingActionButton>,
    );

    fireEvent.mouseEnter(screen.getByRole("button", { name: /开始识别/ }));

    const tooltip = screen.getByText("预计消耗12算力豆");
    expect(tooltip.className).toContain("top-full");
    expect(tooltip.className).not.toContain("bottom-full");
  });

  it("flips tooltip above the button when there is not enough space below", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function mockRect() {
      if ((this as HTMLElement).dataset.testid === "billing-action-wrapper") {
        return {
          x: 120,
          y: 760,
          width: 180,
          height: 44,
          top: 760,
          right: 300,
          bottom: 804,
          left: 120,
          toJSON: () => ({}),
        };
      }
      if ((this as HTMLElement).textContent?.includes("预计消耗12算力豆")) {
        return {
          x: 0,
          y: 0,
          width: 180,
          height: 42,
          top: 0,
          right: 180,
          bottom: 42,
          left: 0,
          toJSON: () => ({}),
        };
      }
      return {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        toJSON: () => ({}),
      };
    });

    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 820,
    });

    render(
      <BillingActionButton priceCredits={12} balanceCredits={50}>
        开始识别
      </BillingActionButton>,
    );

    fireEvent.mouseEnter(screen.getByRole("button", { name: /开始识别/ }));

    const tooltip = screen.getByText("预计消耗12算力豆");
    expect(tooltip.className).toContain("bottom-full");
    expect(tooltip.className).not.toContain("top-full");
  });

  it("still shows and flips tooltip when the button is disabled", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function mockRect() {
      if ((this as HTMLElement).dataset.testid === "billing-action-wrapper") {
        return {
          x: 120,
          y: 760,
          width: 180,
          height: 44,
          top: 760,
          right: 300,
          bottom: 804,
          left: 120,
          toJSON: () => ({}),
        };
      }
      if ((this as HTMLElement).textContent?.includes("预计消耗12算力豆，当前余额不足")) {
        return {
          x: 0,
          y: 0,
          width: 220,
          height: 42,
          top: 0,
          right: 220,
          bottom: 42,
          left: 0,
          toJSON: () => ({}),
        };
      }
      return {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        toJSON: () => ({}),
      };
    });

    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 820,
    });

    render(
      <BillingActionButton priceCredits={12} balanceCredits={1} disabled>
        开始识别
      </BillingActionButton>,
    );

    fireEvent.mouseEnter(screen.getByTestId("billing-action-wrapper"));

    const tooltip = screen.getByText("预计消耗12算力豆，当前余额不足");
    expect(tooltip.className).toContain("bottom-full");
    expect(tooltip.className).not.toContain("top-full");
  });

  it("prefers flipping above when a clipping ancestor leaves no space below", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function mockRect() {
      if ((this as HTMLElement).dataset.testid === "clipping-boundary") {
        return {
          x: 40,
          y: 100,
          width: 400,
          height: 220,
          top: 100,
          right: 440,
          bottom: 320,
          left: 40,
          toJSON: () => ({}),
        };
      }
      if ((this as HTMLElement).dataset.testid === "billing-action-wrapper") {
        return {
          x: 120,
          y: 280,
          width: 180,
          height: 44,
          top: 280,
          right: 300,
          bottom: 324,
          left: 120,
          toJSON: () => ({}),
        };
      }
      if ((this as HTMLElement).textContent?.includes("预计消耗12算力豆")) {
        return {
          x: 0,
          y: 0,
          width: 180,
          height: 42,
          top: 0,
          right: 180,
          bottom: 42,
          left: 0,
          toJSON: () => ({}),
        };
      }
      return {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        toJSON: () => ({}),
      };
    });

    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 900,
    });

    render(
      <div data-testid="clipping-boundary" style={{ overflow: "hidden" }}>
        <BillingActionButton priceCredits={12} balanceCredits={50}>
          开始识别
        </BillingActionButton>
      </div>,
    );

    fireEvent.mouseEnter(screen.getByTestId("billing-action-wrapper"));

    const tooltip = screen.getByText("预计消耗12算力豆");
    expect(tooltip.className).toContain("bottom-full");
    expect(tooltip.className).not.toContain("top-full");
  });
});
