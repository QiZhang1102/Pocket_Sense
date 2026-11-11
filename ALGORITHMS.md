# PocketSense algorithms, v1

## Color space

Canvas requests sRGB decoding. An 8-bit encoded channel v is normalized as u = v / 255. Linear light is u/12.92 when u ≤ 0.04045, otherwise ((u+0.055)/1.055)^2.4. The conventional sRGB→XYZ matrix uses the D65 2° observer reference white (0.95047, 1, 1.08883). CIELAB is calculated with the 6/29 breakpoint. This is **D65 Lab**, unlike CSS `lab()` which uses D50. Values describe the decoded image, not a spectrophotometer measurement.

References: [W3C sRGB](https://www.w3.org/Graphics/Color/sRGB), [CSS Color 4 conversion notes](https://www.w3.org/TR/css-color-4/#color-conversion-code).

## Sampling and palettes

Pixels with alpha < 250 are excluded to avoid silently treating transparent pixels as black or blending with the UI background. Each selected channel is sorted independently. The representative channel is its mean after discarding floor(0.1N) observations from each tail. Median uses the mean of the two central values for even N. Standard deviation is population SD of untrimmed samples. Rectangles are clamped to valid image coordinates; very small regions are flagged.

Large selections use deterministic grid subsampling (~40k samples max). Whole-image palettes use up to ~6k samples and Lab Euclidean k-means with farthest-point initialization, up to 14 iterations. RGB values displayed for each cluster are channel means of the cluster's actual pixels. Homogeneous images may have fewer than the requested 5 or 8 clusters. Reported fractions are sample fractions, not object areas inferred by segmentation.

## Neutral-reference correction

Reference validity requires ≥25 sampled opaque pixels, robust encoded channel values 40–245, ≤1% channel clipping (any channel ≥250), and channel SD ≤18. Convert reference representative RGB to linear c. Target m is the arithmetic mean of c. Gains are gᵢ = m/cᵢ. Reject any gain outside [0.5,2]. Apply corrected = encode(clamp(g × linear(original))). This is a diagonal channel balance with no absolute intensity target and no lux estimation.

When correction is active, sample statistics and palettes use the transformed pixels. Same-image pH reference swatches are transformed by the same gains; known standard reference swatches are left unchanged. Original image and selected-region quality checks are retained so corrected values cannot hide original clipping. The linear-channel operation can introduce clipping; transformed sample quality checks cover it.

## Lighting assessment

Relative Y = 0.2126 Rlinear + 0.7152 Glinear + 0.0722 Blinear. Display mean Y, 32-bin histogram, population SD, all-channel highlight proportion (min RGB ≥250), all-channel near-black proportion (max RGB ≤12), and any-channel highlight proportion (max RGB ≥250). The 10th–90th percentile Y spread flags strong brightness differences. Large spread does not distinguish shading from different material colors. Low global contrast is informative and may be normal for uniform subjects. All thresholds are engineering heuristics, not validated pass/fail criteria for a particular assay.

## Color difference

CIEDE2000 uses kL=kC=kH=1 and explicit hue wrapping and achromatic cases. Tests include all 34 numerical pairs from [Sharma, Wu and Dalal's supplementary dataset](https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/), including near-180° hue cases. Published test data are retained for reproducible verification with attribution; the implementation is written independently from the formula.

## pH matching and interpolation

A profile has 2–30 unique pH labels in [0,14] and distinct valid HEX swatches, sorted by pH. This bounded software range is a scope choice, not a statement that physical pH can never fall outside it. Every sample is compared with every reference in Lab using ΔE00. Default output is the nearest reference category. If the nearest ΔE00 >20, estimate is null; the closest color is still shown for inspection. A <1 ΔE00 separation between the best two matches, except nearly exact matches, triggers ambiguity notice. Boundary matches warn that out-of-range samples cannot be ruled out.

Optional interpolation requires the two best references to be adjacent by pH, the nearest ΔE00 <12, and their label gap ≤2. A 101-point search of their **Lab line segment** minimizes sample ΔE00. Accept only a strictly interior fraction with residual <5; otherwise keep the nearest category. Round the interpolation to one decimal for display. There is no extrapolation and no claim of global RGB monotonicity. Local Lab linearity remains a model assumption requiring independent validation.

For an interpolated result the displayed span uses its two adjacent labels. For nearest-category output it spans the immediately adjacent available labels, clamped to chart bounds. This is a descriptive chart bracket, **not a confidence interval or a calibrated uncertainty bound**.

## Validation and export

Meter metrics require stored records with a photo source (rather than the built-in synthetic image), a non-synthetic profile, finite estimate and entered meter value. This is provenance bookkeeping, not proof that an arbitrary uploaded file is an authentic laboratory photo. MAE = mean(|estimate−reference|), bias = mean(estimate−reference), RMSE = sqrt(mean((estimate−reference)^2)). No demonstration observations are fabricated or inserted.

Export schema `pocketsense.measurement.v1` stores ISO timestamp, source label, working-image dimensions, ROI in working pixels, raw and representative RGB, HEX, D65 Lab, full selected reference profile, calibration gains/ROI, method, estimate, descriptive chart bracket, ΔE00, optional meter pH and QC strings. Exported CSV objects are JSON-encoded, quotes and line breaks escaped, and string formula prefixes guarded for spreadsheet use. Photos and image buffers are omitted.
