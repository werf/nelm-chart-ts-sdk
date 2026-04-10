export interface WerfCommitDate {
    human: string;
    unix: number;
}

export interface WerfCommit {
    hash: string;
    date: WerfCommitDate;
}

export interface WerfImageInfo {
    registry: string;
    namespace: string;
    name: string;
    tag: string;
    digest: string;
    tag_digest: string;
    image: string;
    repository: string;
    ref: string;
    ref_tag: string;
    repository_ref: string;
    repository_tag: string;
    name_ref: string;
    name_tag: string;
}

export interface WerfValues {
    name: string;
    version: string;
    repo: string;
    commit: WerfCommit;
    image: Record<string, string>;
    tag: Record<string, string>;
    namespace?: string;
    env?: string;
    is_stub?: boolean;
    stub_image?: string;
    is_nameless_image?: boolean;
    nameless_image?: string;
}

export interface GlobalWerfValues {
    name: string;
    version: string;
    repo: string;
    commit: WerfCommit;
    images: Record<string, WerfImageInfo>;
    namespace?: string;
    env?: string;
    is_stub?: boolean;
    stub_image?: string;
    is_nameless_image?: boolean;
    nameless_image?: string;
}

export interface GlobalValues {
    werf: GlobalWerfValues;
    env?: string;
}

export interface Values extends Record<string, any> {
    werf?: WerfValues;
    global?: GlobalValues;
    dockerconfigjson?: string;
}

export interface RenderContext {
    Values: Values;
    Release: Release;
    Chart: ChartMetadata;
    Capabilities: Capabilities;
    Runtime: Record<string, any>;
    Files: Record<string, Uint8Array>;
}

export interface Release {
    Name: string;
    Namespace: string;
    Revision: number;
    IsInstall: boolean;
    IsUpgrade: boolean;
    Service: string;
}

export interface ChartMetadata {
    Name: string;
    Version: string;
    AppVersion: string;
    Description: string;
    Home: string;
    Icon: string;
    APIVersion: string;
    Condition: string;
    Tags: string[];
    Type: string;
    Keywords: string[];
    Sources: string[];
    Maintainers: Maintainer[];
    Annotations: Record<string, string>;
}

export interface Maintainer {
    Name: string;
    Email: string;
    URL: string;
}

export interface Capabilities {
    APIVersions: string[];
    KubeVersion: KubeVersion;
    HelmVersion: HelmVersion;
}

export interface KubeVersion {
    Version: string;
    Major: string;
    Minor: string;
}

export interface HelmVersion {
    Version: string;
    GitCommit: string;
    GitTreeState: string;
    GoVersion: string;
}

export interface RenderResult {
    manifests: object[] | null;
}

export type RenderHandler = ($: RenderContext) => Promise<RenderResult> | RenderResult;
