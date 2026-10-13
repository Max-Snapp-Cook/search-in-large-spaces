# search-in-large-spaces


Steps to do/ Goals:

1. Have the LLM prompt to create a game using the examples given(future have its own generated games in the examples)
Figure out what we are going to prompt it. "Create a game that does not exits", "Using these games as referance create a game
that are complex or use aspects of the game", ....

2. Have a parameter whwere we would have to figure out how to filter out bad and good games. Thinking of havign a good 

3. LLM Chain and have it prompt against itself. How would we ask the prompt to make the game?
We can prompt a LLm to look at the game and ask it to evaluate and give a prompt in ways to improve the game.
maybe run it 5-10 times

4. Save the results via ludii runner so we can load the prompt into a file.

5. Luddii Bridge will then Load the Ludii file. 


What is Done thursday.
Hopefully get to this point: Agents versing together is a good demo (LLM versing each other)
If we dont get to this point just simply generate a new game that works using LLM Chain.




Kyle dont knows:

1. Luddi in general so running Ludii via bridge will it jsut take the chess pngs
2. How to get the agents to play each other(maybe get the LLM's to suggest moves) I dont know if we can 
give instructions to the agents.
3. Final evaluator in general but to figure out what is good and what is not
