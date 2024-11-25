import re
from os import listdir
from io import StringIO
from sylk_parser import SylkParser

def quote(m):
    return "\"SYLK_" + m.group(1) + "\""

def main():
    for filename in listdir("data"):
        if filename.endswith(".slk"):
            print("Parsing " + filename)
            with open("data/" + filename, 'r') as readstream:
                slklines = readstream.readlines()
                # SylkParser requires slk files to be preprocessed in order to be able to read them
                with open("data/" + filename[0:-4] + ".slk2", 'w') as writestream:
                    for line in slklines:
                        line = re.sub(r"\\", r"\\\\", line)
                        line = re.sub(r"(?<=K)(FALSE|TRUE|#VALUE!)", quote, line)
                        writestream.write(line)

            parser = SylkParser("data/" + filename + "2")
            with open("data/" + filename[0:-4] + ".csv", 'w') as writestream:
                parser.to_csv(writestream)

main()
