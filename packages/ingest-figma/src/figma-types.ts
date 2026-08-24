/** Minimal typed view of Figma file JSON — only fields the adapter reads.
 * Everything else stays on the raw payload in blob storage. */

export interface VariableAlias {
  type: "VARIABLE_ALIAS";
  id: string;
}

export type BoundVariables = Record<
  string,
  VariableAlias | VariableAlias[] | Record<string, VariableAlias>
>;

export interface FigmaPaint {
  type: string;
  visible?: boolean;
  color?: { r: number; g: number; b: number; a: number };
  boundVariables?: Record<string, VariableAlias>;
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  children?: FigmaNode[];
  boundVariables?: BoundVariables;
  styles?: Record<string, string>;
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  componentId?: string;
  componentProperties?: Record<
    string,
    { type: string; value: string | boolean }
  >;
  componentPropertyDefinitions?: Record<
    string,
    {
      type: "VARIANT" | "BOOLEAN" | "TEXT" | "INSTANCE_SWAP";
      defaultValue?: string | boolean;
      variantOptions?: string[];
    }
  >;
}

export interface FigmaComponentMeta {
  key: string;
  name: string;
  description: string;
  remote: boolean;
  componentSetId?: string;
  documentationLinks?: { uri: string }[];
}

export interface FigmaStyleMeta {
  key: string;
  name: string;
  styleType: string;
  remote: boolean;
  description: string;
}

export interface FigmaFile {
  name: string;
  version: string;
  lastModified: string;
  document: FigmaNode;
  components: Record<string, FigmaComponentMeta>;
  componentSets: Record<string, FigmaComponentMeta>;
  styles: Record<string, FigmaStyleMeta>;
}
