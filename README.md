# @nelm/chart-ts-sdk

The Nelm TypeScript SDK for generating Kubernetes manifests with TypeScript instead of Helm templates.

## Install

```
npm install @nelm/chart-ts-sdk
```

## Example

```ts
import {ChartMetadata, RenderContext, RenderResult} from "@nelm/types";

const newDeployment = ($: RenderContext) => {
    const name = fullname($);

    return {
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
    };
}

export function trunc(str: string, max: number): string {
    if (str.length <= max) return str;
    return str.slice(0, max).replace(/-+$/, '');
}

export function fullname($: RenderContext): string {
    if ($.Values.fullnameOverride) {
        return trunc($.Values.fullnameOverride, 63);
    }

    const chartName = $.Values.nameOverride || $.Chart.Name;

    if ($.Release.Name.includes(chartName)) {
        return trunc($.Release.Name, 63);
    }

    return trunc(`${$.Release.Name}-${chartName}`, 63);
}

export function labels($: RenderContext): Record<string, string> {
    return {
        'app.kubernetes.io/name': $.Chart.Name,
        'app.kubernetes.io/instance': $.Release.Name,
    };
}

export function selectorLabels($: RenderContext): Record<string, string> {
    return {
        'app.kubernetes.io/name': $.Chart.Name,
        'app.kubernetes.io/instance': $.Release.Name,
    };
}

export function render($: RenderContext): RenderResult {
    const result: RenderResult = {
        manifests: []
    }

    result.manifests.push(newDeployment($))
    return result
}
```
