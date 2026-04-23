import * as THREE from 'three';

export function createTerrainMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    roughness: 0.9,
    metalness: 0.0,
    vertexColors: true,
  });

  material.onBeforeCompile = (shader) => {
    // Tunnel hole radius — must stay in sync with TUNNEL_RADIUS in terrain.ts.
    // Hard-coded here to avoid a circular import; bump both together if changed.
    shader.uniforms.uTunnelHoleRadius = { value: 5.0 };

    // --- Vertex shader injection ---
    // Declare attributes and varyings before main()
    const vertexPreamble = /* glsl */ `
      attribute vec3 biomeWeights;
      attribute vec3 biomeIndices;
      attribute float steepness;
      attribute float tunnelDist;

      varying vec3 vBiomeWeights;
      varying vec3 vBiomeIndices;
      varying float vSteepness;
      varying vec2 vWorldPos;
      varying float vTunnelDist;
    `;

    shader.vertexShader = vertexPreamble + shader.vertexShader;

    // Pass attributes to fragment shader inside main()
    const vertexMainInject = /* glsl */ `
      vBiomeWeights = biomeWeights;
      vBiomeIndices = biomeIndices;
      vSteepness = steepness;
      vWorldPos = (modelMatrix * vec4(position, 1.0)).xz;
      vTunnelDist = tunnelDist;
    `;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      vertexMainInject + '\n#include <begin_vertex>'
    );

    // --- Fragment shader injection ---
    const fragmentPreamble = /* glsl */ `
      varying vec3 vBiomeWeights;
      varying vec3 vBiomeIndices;
      varying float vSteepness;
      varying vec2 vWorldPos;
      varying float vTunnelDist;
      uniform float uTunnelHoleRadius;

      float terrainHash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      float terrainNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = terrainHash(i);
        float b = terrainHash(i + vec2(1.0, 0.0));
        float c = terrainHash(i + vec2(0.0, 1.0));
        float d = terrainHash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      float terrainFbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 4; i++) {
          v += a * terrainNoise(p);
          p *= 2.0;
          a *= 0.5;
        }
        return v;
      }

      vec3 getBiomeColor(float biomeIndex, vec2 wp, float steep) {
        int idx = int(biomeIndex + 0.5);
        vec3 col = vec3(0.3);

        if (idx == 0) {
          // Grassland
          vec3 base = vec3(0.25, 0.55, 0.18);
          float stripe = terrainNoise(wp * 0.3) * 0.15;
          float patchVar = terrainFbm(wp * 0.08) * 0.12;
          col = base + vec3(-patchVar, stripe, -patchVar * 0.5);
        } else if (idx == 1) {
          // Forest
          vec3 base = vec3(0.15, 0.4, 0.12);
          float litter = terrainFbm(wp * 0.2) * 0.1;
          float dark = terrainNoise(wp * 0.5) * 0.08;
          col = base + vec3(litter * 0.8, -dark, -litter * 0.3);
        } else if (idx == 2) {
          // Mountains
          vec3 base = vec3(0.45, 0.4, 0.35);
          float rock = terrainFbm(wp * 0.15) * 0.12;
          col = base + vec3(rock * 0.5, rock * 0.3, rock);
          // Grey at high steepness
          vec3 grey = vec3(0.5, 0.48, 0.45);
          col = mix(col, grey, smoothstep(0.3, 0.7, steep));
        } else if (idx == 3) {
          // Desert
          vec3 base = vec3(0.76, 0.65, 0.4);
          float ripple = terrainNoise(wp * vec2(0.4, 0.15)) * 0.08;
          float dune = terrainFbm(wp * 0.06) * 0.1;
          col = base + vec3(ripple, ripple * 0.7, -dune);
        } else if (idx == 4) {
          // Lake shoreline
          vec3 base = vec3(0.2, 0.5, 0.2);
          vec3 teal = vec3(0.15, 0.45, 0.4);
          float shore = terrainFbm(wp * 0.1);
          col = mix(base, teal, smoothstep(0.3, 0.7, shore));
        }

        return col;
      }
    `;

    shader.fragmentShader = fragmentPreamble + shader.fragmentShader;

    // Discard fragments inside tunnel volume — gives a smooth, sub-vertex
    // tunnel hole boundary without modifying geometry.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <clipping_planes_fragment>',
      '#include <clipping_planes_fragment>\n      if (vTunnelDist < uTunnelHoleRadius) discard;'
    );

    // Replace diffuseColor after color_fragment
    const fragmentColorInject = /* glsl */ `
      {
        vec2 wp = vWorldPos;

        // Accumulate blended biome color
        vec3 biomeCol = vec3(0.0);
        biomeCol += vBiomeWeights.x * getBiomeColor(vBiomeIndices.x, wp, vSteepness);
        biomeCol += vBiomeWeights.y * getBiomeColor(vBiomeIndices.y, wp, vSteepness);
        biomeCol += vBiomeWeights.z * getBiomeColor(vBiomeIndices.z, wp, vSteepness);

        // Cliff/rock blend at high steepness
        vec3 cliffColor = vec3(0.42, 0.38, 0.33);
        float cliffRock = terrainFbm(wp * 0.25) * 0.08;
        cliffColor += vec3(cliffRock);
        biomeCol = mix(biomeCol, cliffColor, smoothstep(0.5, 0.85, vSteepness));

        // High-frequency micro-detail to break uniformity
        float micro = terrainNoise(wp * 2.5) * 0.08 - 0.04;
        biomeCol += vec3(micro);

        // Blend procedural color with vertex color (60% procedural, 40% vertex tint)
        diffuseColor.rgb = mix(diffuseColor.rgb, biomeCol, 0.6);
      }
    `;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      '#include <color_fragment>\n' + fragmentColorInject
    );
  };

  return material;
}
