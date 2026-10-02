{{/* The full image reference for a tier: <registry>/<repository>:<tag> */}}
{{- define "plant.image" -}}
{{- $img := index .root.Values.image .tier -}}
{{- printf "%s/%s:%s" .root.Values.image.registry $img.repository $img.tag -}}
{{- end -}}
