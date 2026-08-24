# Future work: measured axes in the 3D viewer

## Goal

Add OpenSCAD-style measured X, Y, and Z axes to Carve's orbitable 3D and hybrid previews. Measurements must remain readable while the camera orbits and zooms, and values must be reported in OpenSCAD coordinates.

## Current viewer architecture

- `media/viewer.js` renders STL meshes with Three.js.
- `previewGroup` is rotated `-90°` around X to convert OpenSCAD's Z-up coordinates to Three.js's Y-up coordinates.
- `fit3dPreview()` frames the combined mesh bounds and updates `OrbitControls.target`.
- The current `THREE.GridHelper(100, 10, ...)` is static and has no numeric labels.
- The shared measurement utilities provide the 1/2/5 adaptive-step algorithm used by the 3D measurement layer.

## Recommended implementation

1. Replace the static `GridHelper` with a measurement group attached to `previewGroup`, so all geometry and labels are generated from OpenSCAD-space coordinates before the existing Z-up conversion.
2. Draw red X, green Y, and blue Z axes with `THREE.LineSegments`.
3. Derive the displayed range from the fitted scene bounds plus padding. Always include the origin, even when the model lies entirely on one side of it.
4. Estimate world units per screen pixel at `controls.target` for the perspective camera:

   ```text
   worldHeight = 2 * distance(camera, target) * tan(verticalFov / 2)
   worldUnitsPerPixel = worldHeight / viewportHeight
   ```

5. Choose a major interval near 60–100 screen pixels using a 1/2/5 × 10ⁿ sequence.
6. Create tick marks and numeric labels at major intervals. Canvas-backed `THREE.Sprite` labels avoid another runtime dependency and naturally face the camera.
7. Keep label size approximately constant in screen space. Rebuild the measurement layer only when the selected interval or displayed range changes, rather than every animation frame.
8. Refresh measurements after camera controls change, viewport resize, and `fit3dPreview()`.
9. Add a viewer toggle so dense axes can be hidden without changing the model.

## Important details

- Labels must show OpenSCAD X/Y/Z values, not the post-rotation Three.js coordinates.
- Axis lines should remain visible without obscuring geometry. Test normal depth behavior first; an overlay mode with `depthTest: false` should be optional rather than automatic.
- Dispose line geometries, sprite materials, and canvas textures whenever the measurement layer is rebuilt.
- Avoid recreating labels on every frame; camera orbit alone does not change their values or positions.
- Very large and very small models should retain stable formatting without `-0` labels or unreadable scientific notation.

## Suggested tests

- Unit-test the perspective world-units-per-pixel calculation.
- Unit-test 1/2/5 interval selection across several orders of magnitude.
- Unit-test tick ranges for positive-only, negative-only, and origin-crossing bounds.
- Assert that the measurement group is attached inside `previewGroup`.
- Manually test orbit, wheel zoom, resize, zoom-to-fit, and hybrid scenes with rotated 2D profiles.

This should be implemented as a separate viewer-only PR; no OpenSCAD WASM changes are required.
