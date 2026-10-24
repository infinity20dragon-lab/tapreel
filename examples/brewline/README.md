# Brewline (sample, desktop layout)

An imaginary coffee-roaster orders dashboard, used to show Tapreel's desktop layout. Nothing here is a real product.

```
node serve.mjs                       # the app on http://localhost:4322
# in another terminal, from this folder:
tapreel voice create woman-warm --use
tapreel music --style warm
tapreel consent                      # you own this fictional app: approve it
tapreel plan && tapreel narrate && tapreel plan --freeze && tapreel plan
tapreel record && tapreel narrate --mix-only && tapreel build
```
`tapreel` is `node <plugin>/bin/tapreel.mjs`. The finished film is written to `tapreel/out/`.
