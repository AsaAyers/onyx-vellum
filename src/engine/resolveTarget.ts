import type { Heading, Root, RootContent } from "mdast";
import type { ContentLocation } from "../transcription/types.js";

export type ContentNode = RootContent;

export type Target = {
  parent: Root;
  startNode: ContentNode | null;
  deleteCount: number;
  headerNodes: ContentNode[];
};

function findFirstHeadingIndex(children: RootContent[]): number {
  return children.findIndex((n) => n.type === "heading");
}

function findBodyStart(children: RootContent[]): number {
  const idx = children.findIndex((n) => n.type !== "yaml");
  return idx === -1 ? children.length : idx;
}

function makeHeading(text: string): Heading {
  return {
    type: "heading",
    depth: 1,
    children: [{ type: "text", value: text }],
  };
}

export function resolveTarget(
  tree: Root,
  location: ContentLocation,
): Target | null {
  const children = tree.children;
  const bodyStart = findBodyStart(children);
  const firstHeadingIdx = findFirstHeadingIndex(children);
  const hasHeadings = firstHeadingIdx !== -1;
  const actualFirstHeading = hasHeadings ? firstHeadingIdx : children.length;

  if (location.header === null) {
    if (location.position === "start") {
      const startNode =
        bodyStart < children.length ? children[bodyStart] : null;
      return {
        parent: tree,
        startNode,
        deleteCount: actualFirstHeading - bodyStart,
        headerNodes: [],
      };
    }
    return {
      parent: tree,
      startNode: null,
      deleteCount: 0,
      headerNodes: [],
    };
  }

  const headerNodeIdx = children.findIndex(
    (n) =>
      n.type === "heading" &&
      n.children.some((c) => c.type === "text" && c.value === location.header),
  );

  if (headerNodeIdx !== -1 && location.position === "end") {
    return {
      parent: tree,
      startNode: null,
      deleteCount: 0,
      headerNodes: [],
    };
  }

  if (headerNodeIdx === -1) {
    const newHeader = makeHeading(location.header);
    if (location.position === "start") {
      const startNode = hasHeadings
        ? children[actualFirstHeading]
        : bodyStart < children.length
          ? children[bodyStart]
          : null;
      return {
        parent: tree,
        startNode,
        deleteCount: hasHeadings ? 0 : actualFirstHeading - bodyStart,
        headerNodes: [newHeader],
      };
    }
    return {
      parent: tree,
      startNode: null,
      deleteCount: 0,
      headerNodes: [newHeader],
    };
  }

  const headerDepth = (children[headerNodeIdx] as Heading).depth;
  const sectionStart = headerNodeIdx + 1;

  const nextHeadingIdx = children.findIndex(
    (node, idx) =>
      node.type === "heading" &&
      node.depth <= headerDepth &&
      idx > headerNodeIdx,
  );

  let deleteCount: number;
  if (nextHeadingIdx === -1) {
    deleteCount = children.length - sectionStart;
  } else {
    deleteCount = nextHeadingIdx - sectionStart;
  }

  const startNode =
    sectionStart < children.length ? children[sectionStart] : null;

  return {
    parent: tree,
    startNode,
    deleteCount,
    headerNodes: [],
  };
}
