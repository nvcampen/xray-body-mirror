# Attribution

## Anatomy data

BodyParts3D, © The Database Center for Life Science, licensed under CC Attribution 4.0 International.

- License: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html
- Terms: https://creativecommons.org/licenses/by/4.0/
- Publication: Mitsuhashi et al. (2009), BodyParts3D: 3D structure database for anatomical concepts. https://doi.org/10.1093/nar/gkn613
- Intermediate source: the processed BodyParts3D 4.0 meshes from https://github.com/ashemag/human-atlas (MIT), metres and Y-up.

Changes made for this app: every structure grouped into six layers (skeleton, muscles, organs, brain and nerves, vessels, skin); meshes simplified with meshoptimizer (about 650,000 triangles remain of 2.3 million); each vertex bound to one or two of 15 body segments; positions quantized to 16 bits and packed into `assets/body.bin.gz`.

BodyParts3D represents a single adult male reference body. It is not a clinical tool.

## Libraries loaded at runtime

- three.js 0.160, MIT License, https://threejs.org
- MediaPipe Tasks Vision 0.10.14 and the Pose Landmarker models, Apache License 2.0, https://ai.google.dev/edge/mediapipe
