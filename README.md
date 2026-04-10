# @nelm/chart-ts-sdk

TypeScript SDK for generating Kubernetes manifests with TypeScript instead of Helm templates.

Runs under [Deno](https://deno.land). Reads a YAML render context from a file, passes it to your handler, and writes the resulting manifests as a multi-document YAML file.

## Install

```
npm install @nelm/chart-ts-sdk
```

## Quick Start

```ts
import {RenderContext, RenderResult, render} from "@nelm/chart-ts-sdk";

function generate($: RenderContext): RenderResult {
    return {
        manifests: [
            {
                apiVersion: 'apps/v1',
                kind: 'Deployment',
                metadata: {
                    name: $.Release.Name,
                    namespace: $.Release.Namespace,
                    labels: {
                        'app.kubernetes.io/name': $.Chart.Name,
                        'app.kubernetes.io/version': $.Chart.AppVersion,
                        'app.kubernetes.io/instance': $.Release.Name,
                    },
                },
                spec: {
                    replicas: $.Values.replicaCount ?? 1,
                    selector: {
                        matchLabels: {
                            'app.kubernetes.io/name': $.Chart.Name,
                            'app.kubernetes.io/instance': $.Release.Name,
                        },
                    },
                    template: {
                        metadata: {
                            labels: {
                                'app.kubernetes.io/name': $.Chart.Name,
                                'app.kubernetes.io/instance': $.Release.Name,
                            },
                        },
                        spec: {
                            containers: [
                                {
                                    name: $.Chart.Name,
                                    image: `${$.Values.image?.repository}:${$.Values.image?.tag}`,
                                    ports: [
                                        {
                                            name: 'http',
                                            containerPort: $.Values.service?.port ?? 80,
                                        },
                                    ],
                                },
                            ],
                        },
                    },
                },
            },
        ],
    };
}

render(generate);
```

## How It Works

`render` is the entry point. It:

1. Parses CLI arguments `--input-file` and `--output-file`
2. Reads the input file as YAML and deserializes it into a `RenderContext`
3. Calls your handler with the context
4. Validates that the result contains a non-empty `manifests` array
5. Serializes each manifest to YAML and writes them to the output file, separated by `---`

```
deno run render.ts --input-file context.yaml --output-file manifests.yaml
```

## API Reference

### `render(handler: RenderHandler): Promise<void>`

Runs the render pipeline. Accepts a handler function that receives a render context and returns `RenderResult`.

### `RenderHandler`

```ts
type RenderHandler<CtxType extends BaseRenderContext = RenderContext> = ($: CtxType) => Promise<RenderResult> | RenderResult;
```

The handler can be sync or async. The generic parameter allows using a narrower context type like `WerfRenderContext`.

### `RenderContext`

The context passed to your handler. By convention, the parameter is named `$`.

```ts
interface RenderContext<ValuesType = Record<string, any>> extends BaseRenderContext {
    Values: ValuesType;                // Merged values (values.yaml + overrides)
    Release: Release;                  // Release metadata
    Chart: ChartMetadata;              // Chart.yaml contents
    Capabilities: Capabilities;        // Cluster capabilities
    Runtime: Record<string, any>;      // Runtime-specific data
    Files: Record<string, Uint8Array>; // Raw chart files
}
```

### `WerfRenderContext`

Render context with werf service values pre-typed. Use this when deploying with werf.

```ts
interface WerfRenderContext {
    Values: WerfValues;                // Werf-typed values (see below)
    Release: Release;
    Chart: ChartMetadata;
    Capabilities: Capabilities;
    Runtime: Record<string, any>;
    Files: Record<string, Uint8Array>;
}

interface WerfValues extends Record<string, any> {
    global: {
        werf: WerfServiceValues;       // Werf service values with typed images
    };
}

interface WerfServiceValues {
    name: string;              // Project name
    version: string;           // Werf version
    repo: string;              // Container registry repo
    commit: {
        hash: string;
        date: {
            human: string;     // Human-readable date string
            unix: number;      // Unix timestamp
        };
    };
    images: Record<string, WerfImageInfo>;
    namespace?: string;
    env?: string;
    is_stub?: boolean;
    stub_image?: string;
}
```

### `WerfImageInfo`

Per-image details available at `$.Values.global.werf.images.<imageName>`.

```ts
interface WerfImageInfo {
    registry: string;          // e.g. "registry.example.com"
    namespace: string;         // e.g. "myproject/myimage"
    name: string;              // e.g. "myimage"
    tag: string;
    digest: string;
    tag_digest: string;        // "tag@digest"
    image: string;             // Full registry/namespace reference
    repository: string;        // "namespace/name"
    ref: string;               // "image:tag@digest"
    ref_tag: string;           // "image:tag"
    repository_ref: string;    // "repository:tag@digest"
    repository_tag: string;    // "repository:tag"
    name_ref: string;          // "name:tag@digest"
    name_tag: string;          // "name:tag"
}
```

### `Release`

```ts
interface Release {
    Name: string;        // Release name
    Namespace: string;   // Target namespace
    Revision: number;    // Release revision number
    IsInstall: boolean;  // true on initial install
    IsUpgrade: boolean;  // true on upgrade
    Service: string;     // Rendering service name
}
```

### `ChartMetadata`

```ts
interface ChartMetadata {
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
```

### `Capabilities`

```ts
interface Capabilities {
    APIVersions: string[];       // Available API versions in the cluster
    KubeVersion: KubeVersion;    // Kubernetes version info
    HelmVersion: HelmVersion;    // Helm version info
}

interface KubeVersion {
    Version: string;  // e.g. "v1.28.0"
    Major: string;
    Minor: string;
}

interface HelmVersion {
    Version: string;
    GitCommit: string;
    GitTreeState: string;
    GoVersion: string;
}
```

### `RenderResult`

```ts
interface RenderResult {
    manifests: object[] | null;  // Array of Kubernetes manifest objects
}
```

The `manifests` array must be non-empty — `render` throws if it's null, undefined, or empty.

## Full Example

A more complete example with helper functions.

Input file (`context.yaml`):

```yaml
Capabilities:
  APIVersions:
    - v1
  HelmVersion:
    go_version: go1.25.0
    version: v3.20
  KubeVersion:
    Major: "1"
    Minor: "35"
    Version: v1.35.0
Chart:
  APIVersion: v2
  Annotations:
    anno: value
  AppVersion: 1.0.0
  Condition: mychart.enabled
  Description: mychart description
  Home: https://example.org/home
  Icon: https://example.org/icon
  Keywords:
    - mychart
  Maintainers:
    - Email: john@example.com
      Name: john
      URL: https://example.com/john
  Name: mychart
  Sources:
    - https://example.org/mychart
  Tags: mychart
  Type: application
  Version: 1.0.0
Files:
  myfile: "content"
Release:
  IsInstall: false
  IsUpgrade: true
  Name: mychart
  Namespace: mychart
  Revision: 2
  Service: Helm
Values:
  image:
    repository: nginx
    tag: latest
  replicaCount: 1
  service:
    enabled: true
    port: 80
    type: ClusterIP
```

Render script (`render.ts`):
```ts
import {RenderContext, RenderResult, render} from "@nelm/chart-ts-sdk";

function trunc(str: string, max: number): string {
    if (str.length <= max) return str;
    return str.slice(0, max).replace(/-+$/, '');
}

function fullname($: RenderContext): string {
    if ($.Values.fullnameOverride) {
        return trunc($.Values.fullnameOverride, 63);
    }

    const chartName = $.Values.nameOverride || $.Chart.Name;

    if ($.Release.Name.includes(chartName)) {
        return trunc($.Release.Name, 63);
    }

    return trunc(`${$.Release.Name}-${chartName}`, 63);
}

function labels($: RenderContext): Record<string, string> {
    return {
        'app.kubernetes.io/name': $.Chart.Name,
        'app.kubernetes.io/instance': $.Release.Name,
        'app.kubernetes.io/version': $.Chart.AppVersion,
        'app.kubernetes.io/managed-by': $.Release.Service,
    };
}

function selectorLabels($: RenderContext): Record<string, string> {
    return {
        'app.kubernetes.io/name': $.Chart.Name,
        'app.kubernetes.io/instance': $.Release.Name,
    };
}

function generate($: RenderContext): RenderResult {
    const name = fullname($);

    return {
        manifests: [
            {
                apiVersion: 'apps/v1',
                kind: 'Deployment',
                metadata: {
                    name: name,
                    labels: labels($),
                },
                spec: {
                    replicas: $.Values.replicaCount ?? 1,
                    selector: {
                        matchLabels: selectorLabels($),
                    },
                    template: {
                        metadata: {
                            labels: selectorLabels($),
                        },
                        spec: {
                            containers: [
                                {
                                    name: name,
                                    image: `${$.Values.image?.repository}:${$.Values.image?.tag}`,
                                    ports: [
                                        {
                                            name: 'http',
                                            containerPort: $.Values.service?.port ?? 80,
                                        },
                                    ],
                                },
                            ],
                        },
                    },
                },
            },
        ],
    };
}

render(generate);
```

Run:

```
deno run render.ts --input-file context.yaml --output-file manifests.yaml
```

## License

[Apache-2.0](LICENSE)
