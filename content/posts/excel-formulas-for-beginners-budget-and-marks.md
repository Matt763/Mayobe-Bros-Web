---
title: "Excel for Beginners: Simple Formulas for a Budget or Marks Sheet"
date: 2026-11-04
author: Mclean Mbaga
category: technology-solutions
label: software
excerpt: Build a small monthly budget sheet step by step. Learn SUM, AVERAGE and cell references, with the same formulas in Google Sheets. No experience needed.
image: assets/posts/excel-formulas-for-beginners-budget-and-marks.webp
imageAlt: A hand holding a pencil over a notebook, shop receipts and a calculator on a desk
imageCredit: Photo: CC0, via rawpixel
imageSource: https://www.rawpixel.com/image/5913662/accountant-free-public-domain-cc0-photo
tags: [students, small business, skills, planning]
---

Maybe you add up your money in your head, or on the back of a receipt. That works until the month gets busy. A spreadsheet does the adding for you, never gets tired, and shows you where the money goes. Learning it costs nothing but a little time, and it is a skill that employers and shop owners use every day.

This post builds one small sheet from nothing. The steps use Excel on a computer, and we also show the same formulas for Google Sheets. Formulas are checked against Microsoft and Google help pages in November 2026. Menus differ between Excel for desktop, Excel for the web and Google Sheets, so the buttons may look a little different on your screen.

## The short answer

A spreadsheet is a grid. Each box is a cell with an address like B2 (column B, row 2). A formula is a calculation you type into a cell.

- Every formula starts with an equals sign (=).
- `=SUM(B2:B6)` adds the cells from B2 down to B6.
- `=AVERAGE(B2:B6)` finds the average of those cells.
- Put numbers in cells and point formulas at the cells. Do not type the numbers inside the formula.
- A dollar sign, as in `$B$7`, keeps a cell address fixed when you copy a formula.

## Your first formula: cells, the equals sign and SUM

Microsoft's guide says that formulas in Excel always begin with the equals sign. To build one, select a cell, type =, then choose cells or type their addresses, add an operator such as + or -, and press Enter.

Let us make a monthly budget. This is an example, not real data. Type these in columns A and B, starting at row 1:

| | A | B |
| --- | --- | --- |
| 1 | Item | Amount (TSh) |
| 2 | Rent | 150000 |
| 3 | Food | 120000 |
| 4 | Transport | 45000 |
| 5 | Airtime and data | 20000 |
| 6 | Books | 15000 |
| 7 | Total | |

Type plain numbers without commas. You can add the comma display later with formatting.

Click cell B7 and type `=SUM(B2:B6)`, then press Enter. Microsoft's page for SUM shows the same pattern, `=SUM(A2:A10)`, which totals cells A2 to A10. The answer in B7 should be 350,000. Check it by hand: 150,000 plus 120,000 is 270,000. Add 45,000 to get 315,000. Add 20,000 to get 335,000. Add 15,000 and you reach 350,000.

You can also use the AutoSum button. Microsoft says it inserts a formula that adds a range of cells for you.

Now you can see the power. Change Food to 100000. The total changes to 330,000 by itself. You did not touch the formula.

## Why not type numbers inside the formula?

You could type `=150000+120000+45000+20000+15000`. It gives the same answer today. But Microsoft says it is best to place constants, the fixed numbers, in their own cells, where they are easy to change and then refer to. If rent goes up, you change one cell, and every formula that uses it updates.

This is the first of two common beginner mistakes. The second is text in a number cell. Say you type `20,000 TSh` with letters in cell B5. Excel sees text, not a number. Microsoft's page says SUM ignores text and adds only the numbers, so your total will be too small, and you may not notice. If you add cells with plus signs instead, such as `=B2+B3+B5`, Microsoft says you get a #VALUE! error when a cell contains text. Keep the amount cells to numbers only, and put words like "TSh" in the heading.

## How do I find an average with AVERAGE?

An average tells you what is typical. Add the numbers, then divide by how many there are. Excel does both steps.

For the budget, click cell B8 and type `=AVERAGE(B2:B6)`. The answer is 70,000, because 350,000 divided by 5 items is 70,000.

Now a marks example. This is a made-up list of four test scores, only to practise: 62, 70, 55 and 81. Type them in cells B2 to B5 on a new sheet. Then `=SUM(B2:B5)` gives 268, and `=AVERAGE(B2:B5)` gives 67, because 268 divided by 4 is 67.

Your school has its own rules for grades and how marks are counted. A spreadsheet only does the arithmetic. Use the grading rules your teacher gives you.

Two details from Microsoft's AVERAGE page are worth knowing. Empty cells in the range are ignored, and so is text. But a cell with a zero is counted. So if a test was not taken, leave the cell empty. Do not type 0 unless the student really scored zero.

## Copy a formula down, and what does the dollar sign do?

Suppose you want to see what share of your total each item takes. In cell C2, type `=B2/$B$7` and press Enter. Rent is 150,000 out of 350,000, so the answer is about 0.43.

Now copy C2 down to C6. Microsoft explains the rule. New formulas use relative references, which shift when you copy them. So `B2` becomes `B3`, then `B4`, and so on, which is what you want for each item. But absolute references, written with dollar signs like `$B$7`, stay fixed. That keeps every row pointing at the total in B7.

If you forget the dollar signs, row 3 would divide by B8, row 4 by B9, and the answers would be wrong. Here the shares come to about 0.43, 0.34, 0.13, 0.06 and 0.04. They add up to 1, which is a good check that you did it right. Use the percent format on the column if you want to see them as percentages.

## Do the same formulas work in Google Sheets?

Yes. Google's function list describes SUM as returning the sum of a series of numbers and/or cells, and AVERAGE as returning the numerical average of a dataset, ignoring text. You type `=SUM(B2:B6)` and `=AVERAGE(B2:B6)` just as in Excel.

Google Sheets is free with a Google account and works in a browser or a phone app. A free web version of Excel exists too, but it needs a Microsoft account, and what it includes can change, so check Microsoft's page. If you worry about data costs, read how to [save mobile data when studying online](/post/educational/online-learning/save-mobile-data-when-studying-online/).

## Common questions

### Why does my cell show the formula instead of the answer?

Usually the cell was set to text, or there is a space before the equals sign. Make sure the formula starts with = and nothing before it.

### Why is my total smaller than expected?

Check for numbers stored as text, such as a value with letters in it. SUM skips text.

### Do I need to buy Excel?

Not to learn these ideas. Google Sheets covers all of them. Check Microsoft's site for what Excel plans cost today, because we do not list prices.

### What is a range?

A range is a block of cells, written with a colon. B2:B6 means B2 down to B6.

## What to do next

1. Make the budget sheet above with your own real items for one month.
2. Add a line for money coming in, and a formula that subtracts your total spending. For example, if you receive 400,000 and spend 350,000, the answer is 50,000.
3. Try the marks example with your own scores, and check one answer by hand.
4. If you run a small stall, the same sheet can track daily sales. Our post on [how to price your products](/post/business-ideas/startups/how-to-price-your-products-small-business-tanzania/) pairs well with it.

A small sheet you built yourself is a real step forward. Start with five rows, and let it grow when you are ready.

## Sources and further reading

- [Overview of formulas in Excel, Microsoft Support](https://support.microsoft.com/en-us/excel/get-started/overview-of-formulas-in-excel)
- [SUM function, Microsoft Support](https://support.microsoft.com/en-us/office/sum-function-043e1c7d-7726-4e80-8f32-07b23e057f89)
- [AVERAGE function, Microsoft Support](https://support.microsoft.com/en-us/excel/functions/average-function)
- [Google Sheets function list, Google Docs Editors Help](https://support.google.com/docs/table/25273)
