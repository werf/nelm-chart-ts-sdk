# @nelm/chart-ts-sdk

TypeScript SDK for generating Kubernetes manifests with TypeScript instead of Helm templates.

Runs under [Deno](https://deno.land). Reads a YAML render context from a file, passes it to your handler, and writes the resulting manifests as a multi-document YAML file.

## Install

```
npm install @nelm/chart-ts-sdk
```

## Quick Start

```ts
import {RenderContext, RenderResult, runRender} from "@nelm/chart-ts-sdk";

function render($: RenderContext): RenderResult {
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

runRender(render);
```

## How It Works

`runRender` is the entry point. It:

1. Parses CLI arguments `--input-file` and `--output-file`
2. Reads the input file as YAML and deserializes it into a `RenderContext`
3. Calls your handler with the context
4. Validates that the result contains a non-empty `manifests` array
5. Serializes each manifest to YAML and writes them to the output file, separated by `---`

```
deno run render.ts --input-file context.yaml --output-file manifests.yaml
```

## API Reference

### `runRender(handler: RenderHandler): Promise<void>`

Runs the render pipeline. Accepts a handler function that receives `RenderContext` and returns `RenderResult`.

### `RenderHandler`

```ts
type RenderHandler = ($: RenderContext) => Promise<RenderResult> | RenderResult;
```

The handler can be sync or async.

### `RenderContext`

The full context passed to your handler. By convention, the parameter is named `$`.

```ts
interface RenderContext {
    Values: Record<string, any>;      // User-supplied values (values.yaml)
    Release: Release;                  // Release metadata
    Chart: ChartMetadata;              // Chart.yaml contents
    Capabilities: Capabilities;        // Cluster capabilities
    Runtime: Record<string, any>;      // Runtime-specific data
    Files: Record<string, Uint8Array>; // Raw chart files
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

The `manifests` array must be non-empty — `runRender` throws if it's null, undefined, or empty.

## Full Example

A more complete example with helper functions.

Input file (`context.yaml`):

```yaml
Capabilities:
  APIVersions:
    - v1
  HelmVersion:
    go_version: go1.25.5
    version: v3.14
  KubeVersion:
    Major: "1"
    Minor: "33"
    Version: v1.33.6+k3s1
Chart:
  APIVersion: v2
  Annotations:
    app.kubernetes.io/managed-by: Helm
  AppVersion: 1.27.4
  Condition: nginx.enabled
  Description: An example Helm chart for Kubernetes
  Home: https://github.com/werf/nelm-chart-ts-sdk
  Icon: https://helm.sh/img/helm.svg
  Keywords:
    - nginx
    - webserver
  Maintainers:
    - Email: maintainer@example.com
      Name: John Doe
      URL: https://example.com
  Name: ts-chart
  Sources:
    - https://github.com/werf/nelm-chart-ts-sdk
  Tags: frontend
  Type: application
  Version: 0.1.0
Files:
  .gitignore: ""
  .helmignore: ""
Release:
  IsInstall: false
  IsUpgrade: true
  Name: ts-chart
  Namespace: ts-chart
  Revision: 171
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
import {RenderContext, RenderResult, runRender} from "@nelm/chart-ts-sdk";

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

function render($: RenderContext): RenderResult {
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

runRender(render);
```

Run:

```
deno run render.ts --input-file context.yaml --output-file manifests.yaml
```

## License

[Apache-2.0](LICENSE)
