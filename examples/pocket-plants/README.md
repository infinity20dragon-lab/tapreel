# Pocket Plants (sample, phone layout)

An imaginary one-page plant-care app, used to show Tapreel end to end. Nothing here is a real product.

```
node serve.mjs                       # the app on http://localhost:4321
# in another terminal, from this folder:
tapreel voice create man-young --use # or any preset: tapreel voice presets
tapreel music --style calm           # royalty-free background track
tapreel consent                      # you own this fictional app: approve it
tapreel plan && tapreel narrate && tapreel plan --freeze && tapreel plan
tapreel record && tapreel narrate --mix-only && tapreel build
```
`tapreel` is `node <plugin>/bin/tapreel.mjs`. The finished film is written to `tapreel/out/`.
