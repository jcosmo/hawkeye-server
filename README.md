Content server for http://github.com/jcosmo/hawkeye

Launch by
```
yarn start
```

To clone nsnta.org to a local directory so that it's available for offline development
```
   wget --mirror --convert-links -R pdf,jpg,gif,png -w 0 http://www.nsnta.org -o ../hawkeye/public
   TBD: ignore DOCs directory,
        make index.html named nsntahome.html,
        index.php files in results dirs -> index.html
        index.php links in results pages -> index.html
        ignore historic results

```