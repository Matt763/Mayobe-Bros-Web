---
title: "How Do AI Chatbots Work? A Plain-Words Explanation"
date: 2026-11-04
author: Mclean Mbaga
category: technology-solutions
label: ai-tools
excerpt: A chatbot answers by guessing the next piece of a sentence, again and again. See what that means, why it can be wrong, and what it cannot do.
image: assets/posts/how-ai-chatbots-work-in-plain-words.webp
imageAlt: Close-up of lines of computer code on a dark screen
imageCredit: Photo: CC0, via rawpixel
imageSource: https://www.rawpixel.com/image/5916657/image-public-domain-computer-free
tags: [technology, ai tools, students]
---

You type a question into a chatbot and, a few seconds later, you get a neat answer. It feels like talking to someone clever. You may wonder how a machine can do this, and whether you can trust it. The idea behind it is simpler than most people think, and understanding it will help you use these tools with confidence.

## The short answer

An AI chatbot is built on a language model. A language model estimates which word, or piece of a word, is likely to come next, given the text so far. The chatbot repeats that step many times and builds an answer one piece at a time.

- It predicts text. It does not look up one true answer in a book.
- It learned patterns from a very large amount of writing during training.
- That is why it sounds fluent, and also why it can be wrong and still sound sure.
- It does not have feelings, and it does not know you.
- You still need to check what it tells you.

## The phone keyboard idea: guessing the next word

Here is an analogy. It is only an analogy, because a chatbot is far more powerful than your phone keyboard. When you type "Habari za" on your phone, the keyboard may suggest "asubuhi" or "leo". It does this because those words often follow. It is guessing the next word from what you typed.

A language model does something like this, on a much bigger scale. Google's machine learning course describes a language model as a system that estimates how likely a token, or a series of tokens, is to appear in a longer series. A token is the smallest unit the model works with. It can be a whole word, part of a word or a single character. Google says most modern models use word pieces, and for English one token is about four characters, or roughly three-quarters of a word.

Google gives an example. Take the sentence "When I hear rain on my roof, I ___ in my kitchen." A model might give "cook soup" a probability of 9.4% and "warm up a kettle" 5.2%. A program then picks one, either the most likely option or a random choice from the likely ones. That small step is the heart of it.

## What happens between pressing send and seeing a reply?

Here is a simple version of the steps. Real systems have more parts, but this shows the idea.

1. You type your question and press send.
2. Your text is cut into tokens.
3. The model looks at the tokens and gives a probability to each possible next token.
4. One token is chosen and added to the text.
5. The model looks at the text again, including the new token, and chooses the next one.
6. This repeats until the answer is complete, and the words appear on your screen.

Because a chatbot works one piece at a time, it is writing as it goes. It is not copying a finished answer from a hidden shelf.

## What does context do?

Context means the words around the spot you want to guess. Google's page uses the word "orange". With the words around it, the model can tell whether you mean the fruit or the colour. Older, simpler methods looked at only a couple of words before the gap and made many mistakes. Google says large language models can look at the whole context at once, which is one reason they handle long questions better.

This is also why a clear question gets a better answer. The more useful words you give, the better the guess. Our post on [how to write a good AI prompt](/post/technology-solutions/ai-tools/how-to-write-a-good-ai-prompt/) shows how.

## Training: learning patterns from a very large amount of text

Before anyone uses a chatbot, the model goes through training. In training, the model is shown a great deal of written text and learns which patterns of words tend to appear together. Think of a student who reads thousands of books and starts to notice how sentences usually go. Again, this is an analogy. A model does not "understand" a book the way you do.

We are not going to state how much text any company used, because those figures come from the companies and we cannot check them. The main point is enough: the chatbot learned patterns of language from its training material, and it uses those patterns to guess what comes next.

Two results follow:

- It can write fluent, well-formed sentences on many topics.
- What it "knows" is limited by what it was trained on. Anthropic, the maker of the Claude chatbot, says on its help page that a model may not have the most up-to-date training data and can be confused about current events. Some chatbots can also search the web, which helps, but their summary can still leave things out.

## Why can a chatbot sound sure and still be wrong?

Because it is built to produce likely text, not to check facts. A sentence can be likely and false at the same time.

The companies say so themselves. Anthropic's help page says its model can give incorrect or misleading answers, which it calls "hallucinating", and that it may write quotes that sound authoritative but are not grounded in fact. It advises people not to treat the chatbot as their only source of truth. Google's help page for Gemini says the tool may sometimes give inaccurate information and that you should double-check its answers, including when it describes how it works.

This matters most for:

- Names, dates, prices and numbers.
- Quotes and book or study titles.
- Medical, legal and money questions.
- School and exam facts, such as fees, cut-offs and rules.

For those, always check an official source. In Tanzania that could be the TCU, NECTA or HESLB website, or the page of the office involved.

## Myth or fact?

| Myth | Fact |
| --- | --- |
| "The chatbot looks up the right answer." | It predicts likely text. Some tools add a web search, but the writing is still a guess. |
| "If it sounds confident, it is right." | Confidence in the wording says nothing about accuracy. |
| "It thinks and feels like a person." | It produces text from patterns. It has no feelings. |
| "It knows everything up to today." | Training material has a cut-off date, and it may be out of date. |
| "One good answer means all answers are good." | Quality changes from question to question. Check each one. |

## What can a chatbot not do?

- It cannot feel, care or hold a real opinion. If it says "I am happy to help," that is a way of writing, not a feeling.
- It cannot be trusted as your only source for facts that matter.
- It cannot know your private situation unless you tell it. If you tell it, think first. Read [what not to paste into AI chatbots](/post/technology-solutions/ai-tools/what-not-to-paste-into-ai-chatbots/) before you share personal details.
- It cannot replace a doctor, lawyer, teacher or adviser. Google's page says not to treat the answers as medical, legal, financial or other professional advice.

None of this means chatbots are useless. They can help you brainstorm, explain a hard idea in simpler words, check your spelling or draft an email you will then correct. See our list of [AI tools for productivity](/post/technology-solutions/ai-tools/top-10-ai-tools-for-productivity/) for ideas. The skill is to use them as a helper and to stay in charge.

## Common questions

### Is a chatbot the same as a search engine?

No. A search engine finds pages that already exist. A chatbot writes new text by predicting words. Some chatbots now include a search step, and then it is worth opening the pages they cite, because the original page may include things the summary left out.

### Why does the answer change when I ask again?

An application can choose among likely tokens instead of always taking the top one, as Google describes. So the same question can give different wording each time.

### Does a chatbot understand what I say?

We avoid saying it understands, because we cannot show that. What we can say is that it handles the words you give it and produces a likely reply.

### Can I use a chatbot for homework?

Use it to learn, not to hand in its words as yours. Check each fact in a reliable source and write the final work yourself. Your school or university may have its own rules, so follow them.

### How do I check an answer?

Look for the claim in an official or trusted source, check the date, and be most careful with numbers and quotes. If you cannot confirm it, do not repeat it.

## What to do next

1. Try the keyboard idea: type half a sentence and see what your phone suggests. It shows how guessing works.
2. Ask a chatbot a question you already know the answer to, and see where it is right and where it is wrong.
3. Next time you use one, pick one fact from the answer and confirm it in an official source.
4. Learn to [spot AI voice and video scams](/post/technology-solutions/ai-tools/ai-voice-and-video-scams-how-to-check/), because the same technology can be misused.

You do not need to be an engineer to use these tools well. You need curiosity and the habit of checking, and you already have both.

## Sources and further reading

- [Introduction to large language models, Google for Developers](https://developers.google.com/machine-learning/resources/intro-llms)
- [Claude is providing incorrect or misleading responses, what's going on?, Anthropic](https://support.claude.com/en/articles/8525154-claude-is-providing-incorrect-or-misleading-responses-what-s-going-on)
- [Gemini Apps Help: how Gemini works and its limits, Google](https://support.google.com/gemini/answer/16279220?hl=en)
