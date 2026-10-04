import type { Page } from '@playwright/test'

// What each stage is, shown in the recording so a video is recognisable on its own.
export const STAGES: Record<string, string> = {
  'classic-ec2': 'EC2 + ALB',
  ecs: 'ECS Fargate',
  'ecs-blue-green': 'ECS blue/green (weighted ALB)',
  eks: 'EKS (Kubernetes)',
  'eks-helm': 'EKS + Helm',
  'eks-gitops': 'EKS + Argo CD (GitOps)',
  'ecs-cognito': 'ECS Fargate + Amazon Cognito sign-in',
  'gcp-cloud-run': 'Google Cloud Run + Cloud SQL',
  'azure-container-apps': 'Azure Container Apps + PostgreSQL',
  serverless: 'Lambda + API Gateway + CloudFront',
}

export const stage = process.env.SMOKE_STAGE ?? 'local'

// A small label in the corner of every page (pointer-events: none, so it never blocks a click).
export async function labelRecording(page: Page, baseURL: string | undefined) {
  const label = `${stage} · ${STAGES[stage] ?? 'local run'} · ${baseURL}`
  await page.addInitScript((text) => {
    window.addEventListener('DOMContentLoaded', () => {
      const el = document.createElement('div')
      el.textContent = text
      el.setAttribute('aria-hidden', 'true')
      el.style.cssText =
        'position:fixed;left:12px;bottom:12px;z-index:2147483647;pointer-events:none;padding:6px 12px;' +
        'border-radius:999px;background:#111;color:#fff;font:600 13px/1.2 ui-monospace,monospace;opacity:.9'
      document.body.appendChild(el)
    })
  }, label)
}
