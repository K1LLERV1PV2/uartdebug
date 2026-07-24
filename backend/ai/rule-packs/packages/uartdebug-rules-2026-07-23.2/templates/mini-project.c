//### File Version
// Revision 1.2.3

/*
    XX_MiniProjectName.c

    This is a template C file for a UartDebug mini-project.

    Keep comments minimal.
    Add linked section markers only when a code fragment must be connected
    with a useful section in the related _help.md or _AI.md file.
*/

#include <xc.h>

#ifndef F_CPU
#define F_CPU 3333333UL
#endif

static void System_Init(void);

static void System_Init(void)
{
    // Add required initialization here.
}

int main(void)
{
    System_Init();

    while (1)
    {
        // Add the main mini-project behavior here.
    }
}
