// ABOUTME: One line of styled segments, cut and padded to exactly its width: the primitive every component draws with.
// ABOUTME: Ink never has to wrap or shrink it, so layouts stay whole-column exact.

import { Text } from "ink";
import { useContext } from "react";

import { Backdrop, backdropSegment } from "./backdrop.js";
import { padSegments, type Segment } from "./text.js";

/** Segments as nested <Text>s inside the enclosing <Text>; gray and dim on an overlay's backdrop. */
export function Segments({ segments }: { segments: readonly Segment[] }) {
  const backdrop = useContext(Backdrop);
  const shown = backdrop ? segments.map(backdropSegment) : segments;
  return (
    <>
      {shown.map(({ text, dim, ...style }, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: segments are a fixed sequence built per render; the position is their identity.
        <Text key={index} {...style} {...(dim ? { dimColor: true } : {})}>
          {text}
        </Text>
      ))}
    </>
  );
}

/** The segments as one line of exactly `width` columns; the padding is drawn in `fill`'s style. */
export function Line({
  segments,
  width,
  fill,
}: {
  segments: readonly Segment[];
  width: number;
  fill?: Omit<Segment, "text">;
}) {
  if (width <= 0) return null;
  return (
    <Text wrap="truncate-end">
      <Segments segments={padSegments(segments, width, fill)} />
    </Text>
  );
}
