# Larry King Scraper

This repo is used to scrape Larry King interviews from CNN for the purpose of fine-tuning a model. It pre-processing the data into a list of JSON objects like this:
```
{"speaker" <speaker>, value: <value>}
```
It pushes all the data to S3 so that the fine-tuning service can read from it.
