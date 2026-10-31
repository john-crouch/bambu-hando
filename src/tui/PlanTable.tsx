// ABOUTME: Per-profile table showing color swatches, plan details, and live sync status.
// ABOUTME: Used for both the pre-apply plan and the progress/summary views.

import { Box, Text } from "ink";
import Spinner from "ink-spinner";

import type { FilamentProfile, Status } from "../models.js";

const COLUMNS = { swatch: 3, name: 22, brand: 12, material: 10, temps: 9, rgba: 10, code: 10, empty: 7, preset: 11, spool: 11 } as const;

export interface RowProgress {
  preset?: Status;
  spool?: Status;
}

function StatusCell({ status, active }: { status: Status | undefined; active: boolean }) {
  if (status === "written") return <Text color="green">✓ written</Text>;
  if (status === "failed") return <Text color="red">✗ failed</Text>;
  if (status === "planned") return <Text color="yellow">○ planned</Text>;
  if (status === "skipped") return <Text dimColor>– skipped</Text>;
  if (active) {
    return (
      <Text color="cyan">
        <Spinner type="dots" /> working
      </Text>
    );
  }
  return <Text dimColor>·</Text>;
}

function Cell({ width, children, dim }: { width: number; children: string; dim?: boolean }) {
  return (
    <Box width={width}>
      <Text wrap="truncate-end" dimColor={dim}>
        {children}
      </Text>
    </Box>
  );
}

interface Props {
  profiles: FilamentProfile[];
  progress: RowProgress[];
  activePresets: boolean;
  activeSpools: boolean;
}

export function PlanTable({ profiles, progress, activePresets, activeSpools }: Props) {
  return (
    <Box flexDirection="column">
      <Box>
        <Cell width={COLUMNS.swatch} dim>
          {""}
        </Cell>
        <Cell width={COLUMNS.name} dim>
          Name
        </Cell>
        <Cell width={COLUMNS.brand} dim>
          Brand
        </Cell>
        <Cell width={COLUMNS.material} dim>
          Material
        </Cell>
        <Cell width={COLUMNS.temps} dim>
          Nozzle°C
        </Cell>
        <Cell width={COLUMNS.rgba} dim>
          RGBA
        </Cell>
        <Cell width={COLUMNS.code} dim>
          Code
        </Cell>
        <Cell width={COLUMNS.empty} dim>
          Empty
        </Cell>
        <Cell width={COLUMNS.preset} dim>
          Preset
        </Cell>
        <Cell width={COLUMNS.spool} dim>
          SpoolEase
        </Cell>
      </Box>
      {profiles.map((profile, index) => {
        const row = progress[index] ?? {};
        return (
          <Box key={`${index}-${profile.name}`}>
            <Box width={COLUMNS.swatch}>
              <Text backgroundColor={`#${profile.colorRgba.slice(0, 6)}`}>{"  "}</Text>
            </Box>
            <Cell width={COLUMNS.name}>{profile.name}</Cell>
            <Cell width={COLUMNS.brand}>{profile.brand}</Cell>
            <Cell width={COLUMNS.material}>{profile.material}</Cell>
            <Cell width={COLUMNS.temps}>{`${profile.nozzleTempMin}-${profile.nozzleTempMax}`}</Cell>
            <Cell width={COLUMNS.rgba}>{profile.colorRgba}</Cell>
            <Cell width={COLUMNS.code}>{profile.filamentId}</Cell>
            <Cell width={COLUMNS.empty}>{profile.coreWeight ? `${profile.coreWeight} g` : "–"}</Cell>
            <Box width={COLUMNS.preset}>
              <StatusCell status={row.preset} active={activePresets} />
            </Box>
            <Box width={COLUMNS.spool}>
              <StatusCell status={row.spool} active={activeSpools} />
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
