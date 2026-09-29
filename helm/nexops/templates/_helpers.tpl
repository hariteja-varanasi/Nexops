{{/* Chart name, overridable */}}
{{- define "nexops.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Fully qualified name: release-chart, or the release name alone if it
     already contains the chart name, so `helm install nexops ./nexops` does
     not produce "nexops-nexops". */}}
{{- define "nexops.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/* Labels on every object. version/managed-by change between releases, so
     they must not go in a selector. */}}
{{- define "nexops.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/name: {{ include "nexops.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: nexops
{{- end -}}

{{/* Selector labels: immutable across upgrades. A Deployment's selector cannot
     be changed after creation, so only stable keys belong here. */}}
{{- define "nexops.selectorLabels" -}}
app.kubernetes.io/name: {{ include "nexops.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "nexops.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "nexops.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/* Name of the Secret to read credentials from. */}}
{{- define "nexops.secretName" -}}
{{- if .Values.secrets.existingSecret -}}
{{- .Values.secrets.existingSecret -}}
{{- else -}}
{{- printf "%s-secrets" (include "nexops.fullname" .) -}}
{{- end -}}
{{- end -}}

{{- define "nexops.postgresHost" -}}
{{- printf "%s-postgres" (include "nexops.fullname" .) -}}
{{- end -}}

{{- define "nexops.redisHost" -}}
{{- printf "%s-redis" (include "nexops.fullname" .) -}}
{{- end -}}

{{/* Image reference builder.

     registry and repository are both optional so the same chart works for a
     registry image and for an image side-loaded into kind:

       registry=docker.io repository=haritejarv  -> docker.io/haritejarv/nexops-backend:1.0.0
       registry="" repository=""                  -> nexops-backend:local

     The second form is what scripts/load-images.sh produces, and it must not
     be prefixed or the kubelet will try to pull it from a registry. */}}
{{- define "nexops.image" -}}
{{- $name := .name -}}
{{- $img := .root.Values.image -}}
{{- $ref := $name -}}
{{- if $img.repository -}}
{{- $ref = printf "%s/%s" $img.repository $name -}}
{{- end -}}
{{- if and $img.registry $img.repository -}}
{{- $ref = printf "%s/%s" $img.registry $ref -}}
{{- end -}}
{{- printf "%s:%s" $ref ($img.tag | toString) -}}
{{- end -}}

{{- define "nexops.backendImage" -}}
{{- include "nexops.image" (dict "root" . "name" .Values.image.backend) -}}
{{- end -}}

{{- define "nexops.frontendImage" -}}
{{- include "nexops.image" (dict "root" . "name" .Values.image.frontend) -}}
{{- end -}}
