<script lang="ts">
  /** Module contract: displays the session-pinned guide, or an honest missing-image
   * placeholder. Legacy sessions alone retain their original SVG pose meaning.
   * Source: docs/slot-setup/matrix.md. Guides never enter captured JPEGs/provider input. */
  import { guideImagePath, sessionGuidePath } from './session/artwork';
  import ProtectedMedia from './ProtectedMedia.svelte';
  import type { Pose } from '../../shared/capture';
  let { pose, sessionId, installationKey, onsettled }: { pose: Pose; sessionId: string; installationKey: string; onsettled?: () => void } = $props();
</script>
{#if pose.guideNumber}
  <div class="pose-guide" aria-label={`Образец позы ${pose.guideNumber}`}>
    {#if pose.guideMediaId}<ProtectedMedia mediaId={pose.guideMediaId} {installationKey} path={guideImagePath(pose.guideMediaId)} sessionPath={sessionGuidePath(sessionId, pose.guideNumber)} {onsettled} alt={`Образец позы: ${pose.instruction}`} contain reveal />
    {:else}<div class="guide-placeholder"><span>Образец №{pose.guideNumber} ещё не загружен</span><small>Следуйте инструкции</small></div>{/if}
  </div>
{:else}
<!-- Diagram is deliberately schematic: direction belongs to the visitor, not a mirrored photo. -->
<svg viewBox="0 0 240 220" role="img" aria-label={`Образец позы: ${pose.instruction}`}>
  <path d="M43 207c3-45 32-62 77-62s74 17 77 62" fill="var(--surface)" stroke="currentColor" stroke-width="3" />
  {#if pose.key === 'profile-left'}
    <path d="M145 151v-26c18-13 25-28 22-50-3-30-25-47-50-43-20 3-31 16-32 37L65 93l19 7v16c0 12 11 18 27 16v19" fill="var(--paper)" stroke="currentColor" stroke-width="3" />
    <path d="M91 75h9m-17 37h13" fill="none" stroke="currentColor" stroke-width="3" />
    <path d="M62 157H22m0 0 12-10m-12 10 12 10" fill="none" stroke="var(--accent)" stroke-width="4" />
  {:else}
    <g transform={pose.key === 'up-left' ? 'rotate(-20 120 90)' : pose.key === 'down-right' ? 'rotate(20 120 90)' : ''}>
      <path d="M101 132v20m38-20v20" stroke="currentColor" stroke-width="3" />
      <ellipse cx="120" cy="86" rx="43" ry="57" fill="var(--paper)" stroke="currentColor" stroke-width="3" />
      <path d="M94 77h13m26 0h13m-26 6-5 17h10m-19 13q14 9 28 0" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
    </g>
    {#if pose.key === 'up-left'}<path d="M62 62 27 27m0 0v23m0-23h23" fill="none" stroke="var(--accent)" stroke-width="4" />
    {:else if pose.key === 'down-right'}<path d="m178 115 35 35m0 0v-23m0 23h-23" fill="none" stroke="var(--accent)" stroke-width="4" />{/if}
  {/if}
</svg>

{/if}
<style>
  .pose-guide { margin-top:16px; min-width:0; }
  .guide-placeholder { display:grid; place-content:center; gap:12px; min-height:150px; padding:16px; border:1px dashed var(--line); border-radius:8px; color:var(--muted); text-align:center; }
  @media(max-width:899px) { .pose-guide { margin:0; } .guide-placeholder { min-height:110px; padding:10px; font-size:13px; } }
</style>
