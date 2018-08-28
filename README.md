Content server for http://github.com/jcosmo/hawkeye

Launch by
```
yarn start
```

To clone nsnta.org to a local directory so that it's available for offline development
```
   wget --mirror --convert-links -R pdf,jpg,gif,png -w 0 -D nsnta.org  -D nsnta.org -X "Docs,results/[0-9]+.*" http://www.nsnta.org -o nsntaclone
   TBD: ignore DOCs directory,
        make index.html named nsntahome.html,
        ignore historic results

```